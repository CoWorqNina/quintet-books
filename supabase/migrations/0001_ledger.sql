-- GGC Books ledger (Supabase Postgres)
--
-- Holds everything that must post atomically: users and roles, periods, journal entries and
-- lines, stored period balances and the audit log. Setup data (Chart of Accounts, parties,
-- templates, schedules) lives in Airtable; account codes and party IDs here refer to it.
--
-- Access: browsers never touch these tables. RLS is on with no policies and anon/authenticated
-- have no grants, so only the app server (secret key, service_role) can read or write. The rules
-- below (balancing, no self-approval, posted entries frozen, closed months locked) are enforced
-- by the database itself, whatever path a change takes.

-- ---------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------

create type book as enum ('Store', 'Commissary');
create type profit_center as enum ('GGC', 'The Nest', 'Shared');
create type app_role as enum ('Owner', 'Accountant', 'Supervisor', 'Staff', 'Commissary In-charge');
create type entry_status as enum ('Draft', 'Submitted', 'Approved', 'Rejected', 'Cancelled');
create type entry_kind as enum ('Template', 'Adjusting', 'Special', 'Free-form', 'Opening', 'Reversal', 'Closing');
-- Statements read "Preliminary" while a period is Open and "Final" once it is closed.
create type period_status as enum ('Open', 'Final');

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table app_users (
  id uuid primary key references auth.users (id),
  email text not null unique,
  full_name text not null,
  role app_role not null,
  books book[] not null default '{Store}',
  profit_centers profit_center[] not null default '{GGC}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table periods (
  key text primary key check (key ~ '^\d{4}-\d{2}$'),
  start_date date not null,
  end_date date not null,
  status period_status not null default 'Open',
  inventory_counted boolean not null default false,
  closed_by uuid references app_users (id),
  closed_at timestamptz
);

create table entries (
  id bigint generated always as identity primary key,
  kind entry_kind not null,
  transaction_type smallint,                       -- Section 7 template number, when kind = Template
  book book not null,
  entry_date date not null,
  period_key text not null references periods (key),
  status entry_status not null default 'Draft',
  description text,
  source_document text,
  reason text,                                     -- required for free-form, special, adjusting, reversal
  unsupported boolean not null default false,      -- expense without receipt, flagged until approved
  attachments jsonb not null default '[]',
  group_id uuid,                                   -- entries that post together (e.g. #19-#21 in both books)
  reverses_entry_id bigint references entries (id),
  created_by uuid not null references app_users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_by uuid references app_users (id),
  approved_at timestamptz,
  rejected_by uuid references app_users (id),
  rejected_at timestamptz,
  rejection_reason text,
  constraint entries_period_matches_date check (period_key = to_char(entry_date, 'YYYY-MM')),
  constraint entries_template_has_type check (kind <> 'Template' or transaction_type is not null),
  constraint entries_reason_required check (
    kind not in ('Free-form', 'Special', 'Adjusting', 'Reversal') or coalesce(btrim(reason), '') <> ''),
  constraint entries_no_self_approval check (approved_by is null or approved_by <> created_by),
  constraint entries_rejection_has_reason check (status <> 'Rejected' or coalesce(btrim(rejection_reason), '') <> '')
);

create index entries_period_idx on entries (period_key, book, status);
create index entries_status_idx on entries (status, created_at);
create index entries_group_idx on entries (group_id) where group_id is not null;
create index entries_created_by_idx on entries (created_by);

create table entry_lines (
  id bigint generated always as identity primary key,
  entry_id bigint not null references entries (id),
  line_no smallint not null,
  account_code text not null check (account_code ~ '^[1-7]\d{3}$'),
  profit_center profit_center,                     -- required on revenue/expense lines (checked by the app)
  debit numeric(14, 2) not null default 0 check (debit >= 0),
  credit numeric(14, 2) not null default 0 check (credit >= 0),
  party_id text,                                   -- Airtable Parties record ID for sub-ledger accounts
  party_name text,                                 -- snapshot for reports
  quantity numeric(14, 3),
  unit text,
  unit_price numeric(14, 4),
  memo text,
  template_line text,
  constraint entry_lines_one_side check ((debit > 0) <> (credit > 0)),
  unique (entry_id, line_no)
);

create index entry_lines_entry_idx on entry_lines (entry_id);
create index entry_lines_account_idx on entry_lines (account_code);
create index entry_lines_party_idx on entry_lines (party_id) where party_id is not null;

-- Movement per account, book, profit center and month from Approved entries only.
-- Opening balance of a month = sum of earlier months; closing = opening + debits - credits.
create table account_period_balances (
  period_key text not null references periods (key),
  book book not null,
  account_code text not null,
  profit_center text not null default 'n/a',
  debits numeric(16, 2) not null default 0,
  credits numeric(16, 2) not null default 0,
  primary key (period_key, book, account_code, profit_center)
);

create table audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid references app_users (id),
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}'
);

create index audit_log_entity_idx on audit_log (entity, entity_id);

-- ---------------------------------------------------------------------------------------------
-- Access: server only
-- ---------------------------------------------------------------------------------------------

alter table app_users enable row level security;
alter table periods enable row level security;
alter table entries enable row level security;
alter table entry_lines enable row level security;
alter table account_period_balances enable row level security;
alter table audit_log enable row level security;

revoke all on app_users, periods, entries, entry_lines, account_period_balances, audit_log
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- The acting app user for audit rows, set by the API functions below.
create function current_actor() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create function set_actor(p_user uuid) returns void
language plpgsql as $$
begin
  if not exists (select 1 from app_users where id = p_user and active) then
    raise exception 'Unknown or inactive user %', p_user using errcode = 'P0001';
  end if;
  perform set_config('app.user_id', p_user::text, true);
end $$;

create function user_role(p_user uuid) returns app_role
language sql stable as $$
  select role from app_users where id = p_user and active
$$;

create function entry_totals(p_entry_id bigint, out total_debit numeric, out total_credit numeric, out line_count int)
language sql stable as $$
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*)::int
  from entry_lines where entry_id = p_entry_id
$$;

create function assert_balanced(p_entry_id bigint) returns void
language plpgsql as $$
declare t record;
begin
  select * into t from entry_totals(p_entry_id);
  if t.line_count < 2 then
    raise exception 'Entry % needs at least two lines', p_entry_id using errcode = 'P0001';
  end if;
  if t.total_debit <> t.total_credit then
    raise exception 'Entry % does not balance: debits % vs credits %', p_entry_id, t.total_debit, t.total_credit
      using errcode = 'P0001';
  end if;
  if t.total_debit = 0 then
    raise exception 'Entry % has no amounts', p_entry_id using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Guards (apply to every write path)
-- ---------------------------------------------------------------------------------------------

create function entries_guard() returns trigger
language plpgsql as $$
declare
  p periods;
begin
  if tg_op = 'DELETE' then
    raise exception 'Entries are never deleted; cancel or reverse instead' using errcode = 'P0001';
  end if;

  select * into p from periods where key = new.period_key;
  if p.status = 'Final' then
    raise exception 'Period % is closed; post the correction in the current open month', new.period_key
      using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    if new.status not in ('Draft', 'Submitted') then
      raise exception 'New entries start as Draft or Submitted' using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- UPDATE
  if old.status in ('Approved', 'Cancelled') then
    raise exception 'Entry % is % and cannot change', old.id, old.status using errcode = 'P0001';
  end if;
  if new.created_by <> old.created_by or new.created_at <> old.created_at or new.kind <> old.kind then
    raise exception 'Creator, creation time and kind cannot change' using errcode = 'P0001';
  end if;
  if old.period_key <> new.period_key
     and exists (select 1 from periods where key = old.period_key and status = 'Final') then
    raise exception 'Period % is closed', old.period_key using errcode = 'P0001';
  end if;

  if new.status <> old.status then
    if not (
      (old.status = 'Draft' and new.status in ('Submitted', 'Cancelled')) or
      (old.status = 'Submitted' and new.status in ('Draft', 'Approved', 'Rejected', 'Cancelled')) or
      (old.status = 'Rejected' and new.status in ('Draft', 'Cancelled'))
    ) then
      raise exception 'Cannot move entry % from % to %', old.id, old.status, new.status using errcode = 'P0001';
    end if;

    if new.status in ('Submitted', 'Approved') then
      perform assert_balanced(new.id);
    end if;

    if new.status = 'Approved' then
      if new.approved_by is null then
        raise exception 'Approval needs an approver' using errcode = 'P0001';
      end if;
      if user_role(new.approved_by) is distinct from 'Owner' then
        raise exception 'Only an active Owner can approve entries' using errcode = 'P0001';
      end if;
      new.approved_at := coalesce(new.approved_at, now());
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

create trigger entries_guard
  before insert or update or delete on entries
  for each row execute function entries_guard();

-- Posting: when an entry becomes Approved, add its lines to the stored period balances.
create function entries_post_balances() returns trigger
language plpgsql as $$
begin
  insert into account_period_balances as b (period_key, book, account_code, profit_center, debits, credits)
  select new.period_key, new.book, l.account_code, coalesce(l.profit_center::text, 'n/a'), sum(l.debit), sum(l.credit)
  from entry_lines l
  where l.entry_id = new.id
  group by l.account_code, coalesce(l.profit_center::text, 'n/a')
  on conflict (period_key, book, account_code, profit_center)
  do update set debits = b.debits + excluded.debits, credits = b.credits + excluded.credits;
  return null;
end $$;

create trigger entries_post_balances
  after update of status on entries
  for each row when (new.status = 'Approved' and old.status <> 'Approved')
  execute function entries_post_balances();

-- Status changes are always audited.
create function entries_audit() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (user_id, action, entity, entity_id, details)
    values (coalesce(current_actor(), new.created_by), 'Create', 'entry', new.id::text,
            jsonb_build_object('status', new.status, 'kind', new.kind, 'book', new.book,
                               'transaction_type', new.transaction_type, 'entry_date', new.entry_date));
  elsif new.status <> old.status then
    insert into audit_log (user_id, action, entity, entity_id, details)
    values (current_actor(),
            case new.status
              when 'Submitted' then 'Submit' when 'Approved' then 'Approve' when 'Rejected' then 'Reject'
              when 'Cancelled' then 'Cancel' when 'Draft' then 'Reopen draft' end,
            'entry', new.id::text,
            jsonb_build_object('from', old.status, 'to', new.status, 'reason', new.rejection_reason));
  end if;
  return null;
end $$;

create trigger entries_audit
  after insert or update on entries
  for each row execute function entries_audit();

-- Lines can only change while their entry is Draft or Submitted.
create function entry_lines_guard() returns trigger
language plpgsql as $$
declare
  s entry_status;
begin
  select status into s from entries where id = coalesce(new.entry_id, old.entry_id);
  if s not in ('Draft', 'Submitted') then
    raise exception 'Lines of a % entry cannot change', s using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.entry_id <> old.entry_id then
    raise exception 'A line cannot move to another entry' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

create trigger entry_lines_guard
  before insert or update or delete on entry_lines
  for each row execute function entry_lines_guard();

-- Audit log and balances are append-only / trigger-maintained.
create function forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception '% rows cannot be changed or deleted', tg_table_name using errcode = 'P0001';
end $$;

create trigger audit_log_immutable
  before update or delete on audit_log
  for each row execute function forbid_change();

create trigger balances_no_delete
  before delete on account_period_balances
  for each row execute function forbid_change();

create function periods_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Periods are never deleted' using errcode = 'P0001';
  end if;
  if new.status = 'Final' and old.status = 'Open' then
    if exists (select 1 from periods where key < new.key and status = 'Open') then
      raise exception 'Close earlier periods first' using errcode = 'P0001';
    end if;
    if exists (select 1 from entries where period_key = new.key and status in ('Draft', 'Submitted')) then
      raise exception 'Period % still has Draft or Submitted entries', new.key using errcode = 'P0001';
    end if;
  end if;
  if new.status = 'Open' and old.status = 'Final'
     and exists (select 1 from periods where key > new.key and status = 'Final') then
    raise exception 'Reopen later periods first' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger periods_guard
  before update or delete on periods
  for each row execute function periods_guard();

-- ---------------------------------------------------------------------------------------------
-- API functions (called by the app server with the acting user's ID)
-- ---------------------------------------------------------------------------------------------

-- Inserts one entry with its lines. Used by create_entries and reverse_entry.
create function insert_entry(p_user uuid, p_entry jsonb, p_status entry_status, p_group uuid)
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

  insert into entries (kind, transaction_type, book, entry_date, period_key, status, description,
                       source_document, reason, unsupported, attachments, group_id, reverses_entry_id,
                       created_by)
  values ((p_entry ->> 'kind')::entry_kind,
          (p_entry ->> 'transaction_type')::smallint,
          (p_entry ->> 'book')::book,
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

-- Creates one or more entries atomically. Several entries share a group and are approved,
-- rejected, cancelled and reversed together.
create function create_entries(p_user uuid, p_entries jsonb, p_submit boolean default true)
returns bigint[]
language plpgsql as $$
declare
  v_ids bigint[] := '{}';
  v_group uuid := case when jsonb_array_length(p_entries) > 1 then gen_random_uuid() end;
  v_entry jsonb;
begin
  perform set_actor(p_user);
  for v_entry in select * from jsonb_array_elements(p_entries) loop
    v_ids := v_ids || insert_entry(p_user, v_entry,
                                   case when p_submit then 'Submitted'::entry_status else 'Draft' end,
                                   v_group);
  end loop;
  return v_ids;
end $$;

-- Replaces header fields and lines of a Draft, Submitted or Rejected entry (Supervisor edit flow).
-- The previous version is kept in the audit log.
create function update_entry(p_user uuid, p_entry_id bigint, p_entry jsonb, p_submit boolean default true)
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
                             party_name, quantity, unit, unit_price, memo, template_line)
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
            v_line ->> 'template_line');
  end loop;

  if p_submit then
    update entries set status = 'Submitted', submitted_at = now() where id = p_entry_id and status = 'Draft';
    perform assert_balanced(p_entry_id);
  else
    update entries set status = 'Draft' where id = p_entry_id and status = 'Submitted';
  end if;
end $$;

-- All entries in the same group as the given ones (an entry with no group is its own group).
create function with_group(p_ids bigint[]) returns setof bigint
language sql stable as $$
  select distinct e.id from entries e
  where e.id = any (p_ids)
     or e.group_id in (select group_id from entries where id = any (p_ids) and group_id is not null)
$$;

create function submit_entries(p_user uuid, p_ids bigint[]) returns void
language plpgsql as $$
begin
  perform set_actor(p_user);
  update entries set status = 'Submitted', submitted_at = now()
  where id in (select with_group(p_ids)) and status = 'Draft';
end $$;

-- Approves Submitted entries (with their whole group). Batch approval of routine template
-- entries is decided by the app; the database checks approver role, no self-approval and balance.
create function approve_entries(p_user uuid, p_ids bigint[]) returns int
language plpgsql as $$
declare
  v_count int;
  v_ids bigint[] := array(select with_group(p_ids));
begin
  perform set_actor(p_user);
  if exists (select 1 from entries where id = any (v_ids) and status <> 'Submitted') then
    raise exception 'Only Submitted entries can be approved' using errcode = 'P0001';
  end if;
  perform 1 from entries where id = any (v_ids) for update;
  update entries set status = 'Approved', approved_by = p_user, approved_at = now()
  where id = any (v_ids);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create function reject_entry(p_user uuid, p_id bigint, p_reason text) returns void
language plpgsql as $$
begin
  perform set_actor(p_user);
  if user_role(p_user) is distinct from 'Owner' then
    raise exception 'Only an Owner can reject entries' using errcode = 'P0001';
  end if;
  update entries set status = 'Rejected', rejected_by = p_user, rejected_at = now(), rejection_reason = p_reason
  where id in (select with_group(array[p_id])) and status = 'Submitted';
  if not found then
    raise exception 'Entry % is not Submitted', p_id using errcode = 'P0001';
  end if;
end $$;

create function cancel_entry(p_user uuid, p_id bigint) returns void
language plpgsql as $$
begin
  perform set_actor(p_user);
  update entries set status = 'Cancelled'
  where id in (select with_group(array[p_id])) and status in ('Draft', 'Submitted', 'Rejected');
  if not found then
    raise exception 'Entry % cannot be cancelled; reverse it instead', p_id using errcode = 'P0001';
  end if;
end $$;

-- Reverses an Approved entry (and its group) with mirror-image entries, optionally adding
-- corrected replacement entries. Everything is created Submitted for owner approval.
-- p_entry_date defaults to the original date; it must be given when that month is closed.
create function reverse_entry(p_user uuid, p_id bigint, p_reason text,
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

create function close_period(p_user uuid, p_key text) returns void
language plpgsql as $$
begin
  perform set_actor(p_user);
  if user_role(p_user) is distinct from 'Owner' then
    raise exception 'Only an Owner can close a month' using errcode = 'P0001';
  end if;
  update periods set status = 'Final', closed_by = p_user, closed_at = now() where key = p_key and status = 'Open';
  if not found then
    raise exception 'Period % is not open', p_key using errcode = 'P0001';
  end if;
  insert into audit_log (user_id, action, entity, entity_id) values (p_user, 'Close', 'period', p_key);
end $$;

create function reopen_period(p_user uuid, p_key text, p_reason text) returns void
language plpgsql as $$
begin
  perform set_actor(p_user);
  if user_role(p_user) is distinct from 'Owner' then
    raise exception 'Only an Owner can reopen a month' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Reopening needs a reason' using errcode = 'P0001';
  end if;
  update periods set status = 'Open', closed_by = null, closed_at = null where key = p_key and status = 'Final';
  if not found then
    raise exception 'Period % is not closed', p_key using errcode = 'P0001';
  end if;
  insert into audit_log (user_id, action, entity, entity_id, details)
  values (p_user, 'Reopen', 'period', p_key, jsonb_build_object('reason', p_reason));
end $$;

-- Only the app server may call any of these.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
grant all on app_users, periods, entries, entry_lines, account_period_balances, audit_log to service_role;

-- ---------------------------------------------------------------------------------------------
-- Seed: monthly periods from the opening-balance month (Oct 2026) through 2030
-- ---------------------------------------------------------------------------------------------

insert into periods (key, start_date, end_date)
select to_char(m, 'YYYY-MM'), m::date, (m + interval '1 month - 1 day')::date
from generate_series(date '2026-10-01', date '2030-12-01', interval '1 month') as m;
