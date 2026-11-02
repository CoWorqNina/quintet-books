-- Open items: pay specific bills. A payment line can name the line it settles (a supplier invoice,
-- a card or SPayLater charge, a reimbursement), and a payable line can carry its due date.
-- Run after 0008_loan_interest_before_go_live.sql.

alter table entry_lines add column if not exists settles_line_id bigint references entry_lines (id);
alter table entry_lines add column if not exists due_date date;
create index if not exists entry_lines_settles_idx on entry_lines (settles_line_id) where settles_line_id is not null;

-- A settling line must be on the same account as the line it settles, on the other side.
create or replace function check_settlement() returns trigger
language plpgsql as $$
declare
  t entry_lines;
begin
  if new.settles_line_id is null then
    return new;
  end if;
  select * into t from entry_lines where id = new.settles_line_id;
  if t.id is null then
    raise exception 'The bill being paid (line %) was not found', new.settles_line_id using errcode = 'P0001';
  end if;
  if t.account_code <> new.account_code or (t.credit > 0) = (new.credit > 0) then
    raise exception 'A payment must be on the same account as the bill it pays (%)', t.account_code using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists entry_lines_settlement on entry_lines;
create trigger entry_lines_settlement before insert or update on entry_lines
  for each row execute function check_settlement();

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
                       daily_report_id, classifies_entry_id, form, created_by)
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
          (p_entry ->> 'classifies_entry_id')::bigint,
          p_entry -> 'form',
          p_user)
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_entry -> 'lines') loop
    v_no := v_no + 1;
    insert into entry_lines (entry_id, line_no, account_code, profit_center, debit, credit, party_id,
                             party_name, quantity, unit, unit_price, memo, template_line,
                             settles_line_id, due_date)
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
            v_line ->> 'template_line',
            (v_line ->> 'settles_line_id')::bigint,
            (v_line ->> 'due_date')::date);
  end loop;

  if p_status = 'Submitted' then
    update entries set status = 'Submitted', submitted_at = now() where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function update_entry(p_user uuid, p_entry_id bigint, p_entry jsonb, p_submit boolean default true)
returns void
language plpgsql as $$
declare
  e entries;
  v_line jsonb;
  v_no smallint := 0;
  v_date date := (p_entry ->> 'entry_date')::date;
begin
  perform set_actor(p_user);
  select * into e from entries where id = p_entry_id for update;
  if e.id is null then
    raise exception 'Entry % not found', p_entry_id using errcode = 'P0001';
  end if;
  if e.status not in ('Draft', 'Submitted', 'Rejected') then
    raise exception 'Entry % is % and cannot be edited; reverse it instead', p_entry_id, e.status
      using errcode = 'P0001';
  end if;

  insert into audit_log (user_id, action, entity, entity_id, details)
  values (p_user, 'Edit', 'entry', p_entry_id::text, jsonb_build_object(
    'before', to_jsonb(e) - 'attachments',
    'before_lines', (select coalesce(jsonb_agg(to_jsonb(l) order by l.line_no), '[]')
                     from entry_lines l where l.entry_id = p_entry_id)));

  if e.status = 'Rejected' then
    update entries set status = 'Draft' where id = p_entry_id;
  end if;

  update entries set
    entry_date = v_date,
    period_key = to_char(v_date, 'YYYY-MM'),
    book = (p_entry ->> 'book')::book,
    description = p_entry ->> 'description',
    source_document = p_entry ->> 'source_document',
    reason = p_entry ->> 'reason',
    unsupported = coalesce((p_entry ->> 'unsupported')::boolean, false),
    attachments = coalesce(p_entry -> 'attachments', attachments),
    rejection_reason = null, rejected_by = null, rejected_at = null
  where id = p_entry_id;

  delete from entry_lines where entry_id = p_entry_id;
  for v_line in select * from jsonb_array_elements(p_entry -> 'lines') loop
    v_no := v_no + 1;
    insert into entry_lines (entry_id, line_no, account_code, profit_center, debit, credit, party_id,
                             party_name, quantity, unit, unit_price, memo, template_line,
                             settles_line_id, due_date)
    values (p_entry_id, v_no,
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
            v_line ->> 'template_line',
            (v_line ->> 'settles_line_id')::bigint,
            (v_line ->> 'due_date')::date);
  end loop;

  if p_submit then
    update entries set status = 'Submitted', submitted_at = now() where id = p_entry_id and status = 'Draft';
    perform assert_balanced(p_entry_id);
  else
    update entries set status = 'Draft' where id = p_entry_id and status = 'Submitted';
  end if;
end $$;

-- Approved lines per account and party, with the line's id, the bill it settles and its due date.
-- An entry and its approved reversal (both dated by p_to) cancel out and are left out, so a
-- reversed payment re-opens the bill it paid.
drop function if exists party_lines(text[], date);
create function party_lines(p_accounts text[], p_to date)
returns table (book book, account_code text, party_id text, party_name text, entry_id bigint,
               entry_date date, description text, debit numeric, credit numeric,
               line_id bigint, settles_line_id bigint, due_date date, memo text, source_document text)
language sql stable as $$
  select e.book, l.account_code, l.party_id, l.party_name, e.id, e.entry_date, e.description, l.debit, l.credit,
         l.id, l.settles_line_id, l.due_date, l.memo, e.source_document
  from entry_lines l
  join entries e on e.id = l.entry_id
  where e.status = 'Approved' and l.account_code = any (p_accounts) and e.entry_date <= p_to
    and not (e.kind = 'Reversal' and exists (
          select 1 from entries o where o.id = e.reverses_entry_id and o.status = 'Approved' and o.entry_date <= p_to))
    and not exists (select 1 from entries r where r.reverses_entry_id = e.id and r.status = 'Approved' and r.entry_date <= p_to)
  order by e.entry_date, e.id, l.line_no
$$;

-- Payments still waiting for approval, per bill they settle (so a bill isn't paid twice).
create or replace function pending_settlements(p_accounts text[])
returns table (settles_line_id bigint, entry_id bigint, amount numeric)
language sql stable as $$
  select l.settles_line_id, e.id, sum(l.debit + l.credit)
  from entry_lines l
  join entries e on e.id = l.entry_id
  where e.status in ('Draft', 'Submitted') and l.settles_line_id is not null and l.account_code = any (p_accounts)
  group by l.settles_line_id, e.id
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
