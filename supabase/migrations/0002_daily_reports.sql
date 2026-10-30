-- Phase 1: daily cashier reports, profit-center visibility on entries, attachments bucket.
-- Run after 0001_ledger.sql.

-- The profit center an entry belongs to (GGC or The Nest); controls who can see it.
alter table entries add column profit_center profit_center;

-- One encoded cashier report per business day per profit center. Its figures generate the day's
-- sales, staff charge, petty cash and drawer entries; the report keeps the raw numbers and photos.
create table daily_reports (
  id bigint generated always as identity primary key,
  business_date date not null,
  book book not null default 'Store',
  profit_center profit_center not null check (profit_center in ('GGC', 'The Nest')),
  status text not null default 'Active' check (status in ('Active', 'Cancelled')),
  pos jsonb not null,             -- POS sales summary: gross, refunds, discounts, net, channel amounts
  drawer jsonb not null,          -- cash drawer: beginning, cash ins, actual count, remitted, next-day petty cash
  paid_outs jsonb not null default '[]',
  food_charges jsonb not null default '[]',
  attachments jsonb not null default '[]',
  notes text,
  created_by uuid not null references app_users (id),
  created_at timestamptz not null default now(),
  cancelled_by uuid references app_users (id),
  cancelled_at timestamptz,
  cancel_reason text
);

create unique index daily_reports_one_per_day on daily_reports (business_date, profit_center)
  where status = 'Active';

alter table entries add column daily_report_id bigint references daily_reports (id);
create index entries_daily_report_idx on entries (daily_report_id) where daily_report_id is not null;

alter table daily_reports enable row level security;
revoke all on daily_reports from public, anon, authenticated;
grant all on daily_reports to service_role;

create trigger daily_reports_no_delete
  before delete on daily_reports
  for each row execute function forbid_change();

-- insert_entry now also stores the entry's profit center and daily report.
create or replace function insert_entry(p_user uuid, p_entry jsonb, p_status entry_status, p_group uuid)
returns bigint
language plpgsql as $$
declare
  v_id bigint;
  v_date date := (p_entry ->> 'entry_date')::date;
  v_line jsonb;
  v_no smallint := 0;
begin
  if jsonb_typeof(p_entry -> 'lines') <> 'array' or jsonb_array_length(p_entry -> 'lines') = 0 then
    raise exception 'An entry needs lines' using errcode = 'P0001';
  end if;

  insert into entries (kind, transaction_type, book, profit_center, entry_date, period_key, status, description,
                       source_document, reason, unsupported, attachments, group_id, reverses_entry_id,
                       daily_report_id, created_by)
  values ((p_entry ->> 'kind')::entry_kind,
          (p_entry ->> 'transaction_type')::smallint,
          (p_entry ->> 'book')::book,
          (p_entry ->> 'profit_center')::profit_center,
          v_date,
          to_char(v_date, 'YYYY-MM'),
          'Draft',
          p_entry ->> 'description',
          p_entry ->> 'source_document',
          p_entry ->> 'reason',
          coalesce((p_entry ->> 'unsupported')::boolean, false),
          coalesce(p_entry -> 'attachments', '[]'),
          p_group,
          (p_entry ->> 'reverses_entry_id')::bigint,
          (p_entry ->> 'daily_report_id')::bigint,
          p_user)
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_entry -> 'lines') loop
    v_no := v_no + 1;
    insert into entry_lines (entry_id, line_no, account_code, profit_center, debit, credit, party_id,
                             party_name, quantity, unit, unit_price, memo, template_line)
    values (v_id, v_no,
            v_line ->> 'account_code',
            (v_line ->> 'profit_center')::profit_center,
            coalesce((v_line ->> 'debit')::numeric, 0),
            coalesce((v_line ->> 'credit')::numeric, 0),
            v_line ->> 'party_id',
            v_line ->> 'party_name',
            (v_line ->> 'quantity')::numeric,
            v_line ->> 'unit',
            (v_line ->> 'unit_price')::numeric,
            v_line ->> 'memo',
            v_line ->> 'template_line');
  end loop;

  if p_status = 'Submitted' then
    update entries set status = 'Submitted', submitted_at = now() where id = v_id;
  end if;
  return v_id;
end $$;

-- Reversals copy the original entry's profit center.
create or replace function reverse_entry(p_user uuid, p_id bigint, p_reason text,
                                         p_replacements jsonb default '[]', p_entry_date date default null)
returns bigint[]
language plpgsql as $$
declare
  v_ids bigint[] := '{}';
  v_group uuid := gen_random_uuid();
  e entries;
  v_rep jsonb;
begin
  perform set_actor(p_user);
  if exists (select 1 from entries where id in (select with_group(array[p_id])) and status <> 'Approved') then
    raise exception 'Only Approved entries are reversed; edit or cancel the others' using errcode = 'P0001';
  end if;
  if exists (select 1 from entries where reverses_entry_id in (select with_group(array[p_id]))
             and status not in ('Rejected', 'Cancelled')) then
    raise exception 'Entry % already has a reversal' , p_id using errcode = 'P0001';
  end if;

  for e in select * from entries where id in (select with_group(array[p_id])) order by id loop
    v_ids := v_ids || insert_entry(p_user, jsonb_build_object(
      'kind', 'Reversal',
      'transaction_type', e.transaction_type,
      'book', e.book,
      'profit_center', e.profit_center,
      'entry_date', coalesce(p_entry_date, e.entry_date),
      'description', 'Reversal of entry ' || e.id || coalesce(': ' || e.description, ''),
      'source_document', e.source_document,
      'reason', p_reason,
      'reverses_entry_id', e.id,
      'lines', (select jsonb_agg(jsonb_build_object(
                  'account_code', l.account_code, 'profit_center', l.profit_center,
                  'debit', l.credit, 'credit', l.debit, 'party_id', l.party_id, 'party_name', l.party_name,
                  'quantity', l.quantity, 'unit', l.unit, 'unit_price', l.unit_price, 'memo', l.memo,
                  'template_line', l.template_line) order by l.line_no)
                from entry_lines l where l.entry_id = e.id)),
      'Submitted', v_group);
  end loop;

  for v_rep in select * from jsonb_array_elements(coalesce(p_replacements, '[]')) loop
    v_ids := v_ids || insert_entry(p_user, v_rep, 'Submitted', v_group);
  end loop;
  return v_ids;
end $$;

-- Saves a daily report and creates its entries (each Submitted, approved separately) in one step.
create function create_daily_report(p_user uuid, p_report jsonb, p_entries jsonb)
returns jsonb
language plpgsql as $$
declare
  v_report_id bigint;
  v_ids bigint[] := '{}';
  v_entry jsonb;
begin
  perform set_actor(p_user);
  insert into daily_reports (business_date, book, profit_center, pos, drawer, paid_outs, food_charges,
                             attachments, notes, created_by)
  values ((p_report ->> 'business_date')::date,
          coalesce((p_report ->> 'book')::book, 'Store'),
          (p_report ->> 'profit_center')::profit_center,
          p_report -> 'pos',
          p_report -> 'drawer',
          coalesce(p_report -> 'paid_outs', '[]'),
          coalesce(p_report -> 'food_charges', '[]'),
          coalesce(p_report -> 'attachments', '[]'),
          p_report ->> 'notes',
          p_user)
  returning id into v_report_id;

  for v_entry in select * from jsonb_array_elements(p_entries) loop
    v_ids := v_ids || insert_entry(p_user, v_entry || jsonb_build_object('daily_report_id', v_report_id),
                                   'Submitted', null);
  end loop;

  insert into audit_log (user_id, action, entity, entity_id, details)
  values (p_user, 'Create', 'daily_report', v_report_id::text, jsonb_build_object('entries', v_ids));
  return jsonb_build_object('report_id', v_report_id, 'entry_ids', v_ids);
exception when unique_violation then
  raise exception 'A daily report for % (%) already exists; cancel it first to re-enter',
    p_report ->> 'business_date', p_report ->> 'profit_center' using errcode = 'P0001';
end $$;

-- Cancels a report and its entries so it can be re-entered. Not allowed once any entry is
-- Approved: those are corrected by reversal instead.
create function cancel_daily_report(p_user uuid, p_id bigint, p_reason text) returns void
language plpgsql as $$
begin
  perform set_actor(p_user);
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Cancelling a daily report needs a reason' using errcode = 'P0001';
  end if;
  if exists (select 1 from entries where daily_report_id = p_id and status = 'Approved') then
    raise exception 'Some entries of this report are already approved; reverse them instead' using errcode = 'P0001';
  end if;
  update entries set status = 'Cancelled'
  where daily_report_id = p_id and status in ('Draft', 'Submitted', 'Rejected');
  update daily_reports set status = 'Cancelled', cancelled_by = p_user, cancelled_at = now(), cancel_reason = p_reason
  where id = p_id and status = 'Active';
  if not found then
    raise exception 'Daily report % is not active', p_id using errcode = 'P0001';
  end if;
  insert into audit_log (user_id, action, entity, entity_id, details)
  values (p_user, 'Cancel', 'daily_report', p_id::text, jsonb_build_object('reason', p_reason));
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

-- Private buckets (only the app server reads them): receipts, report photos and statements;
-- and the nightly ledger backups.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('attachments', 'attachments', false, 5242880,
            array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
    on conflict (id) do nothing;
    insert into storage.buckets (id, name, public, allowed_mime_types)
    values ('backups', 'backups', false, array['application/gzip'])
    on conflict (id) do nothing;
  end if;
end $$;
