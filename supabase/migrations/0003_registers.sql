-- Phase 2: schedules created together with entries (Fixed Asset Register, prepaid/deferred
-- spreads, Loan Tracker), the template values behind each entry (for corrections), and the
-- link from a classification entry to the unclassified movement it settles.
-- Run after 0002_daily_reports.sql.

alter table entries add column form jsonb;                 -- template + values the entry was built from
alter table entries add column classifies_entry_id bigint references entries (id);

-- A register row is in force while the entry that created it is not Rejected/Cancelled and has
-- not been reversed. Rows with no entry are go-live records matched by the opening balances.

create table fixed_assets (
  id bigint generated always as identity primary key,
  name text not null,
  book book not null,
  account_code text not null,               -- Property & Equipment class (1510-1560)
  accum_account_code text not null,         -- matching Accumulated Depreciation (1591-1596)
  profit_center profit_center not null,     -- GGC, The Nest or Shared
  cost numeric(14, 2) not null check (cost > 0),
  acquired_date date not null,
  in_use_date date not null,
  useful_life_months int not null check (useful_life_months > 0),
  depreciated_before_go_live numeric(14, 2) not null default 0,
  popup boolean not null default false,     -- "purchased for pop-ups"
  status text not null default 'Active' check (status in ('Active', 'Disposed')),
  entry_id bigint references entries (id),
  notes text,
  created_by uuid not null references app_users (id),
  created_at timestamptz not null default now()
);

create table spread_schedules (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('Prepaid', 'Deferred charge')),
  name text not null,
  book book not null,
  asset_account text not null,              -- 1430 Prepaid Expenses, 1610/1620 deferred charges
  expense_account text not null,            -- 6823 / 6821 / 6822 (or rent for pre-opening rent)
  profit_center profit_center not null,
  total numeric(14, 2) not null check (total > 0),
  start_month date not null check (extract(day from start_month) = 1),
  months int not null check (months > 0),
  amortized_before_go_live numeric(14, 2) not null default 0,
  entry_id bigint references entries (id),
  created_by uuid not null references app_users (id),
  created_at timestamptz not null default now()
);

create table loans (
  id bigint generated always as identity primary key,
  name text not null,
  lender_party_id text,
  lender_name text not null,
  account_code text not null,               -- the loan's own Loans Payable account
  interest_account text not null,           -- 7510 / 7520 / 7530
  book book not null default 'Store',
  principal numeric(14, 2) not null check (principal > 0),
  annual_rate numeric(8, 4) not null default 0,
  term_months int not null check (term_months > 0),
  start_date date not null,
  informal boolean not null default false,  -- schedule built from agreed terms, not a lender schedule
  entry_id bigint references entries (id),
  notes text,
  created_by uuid not null references app_users (id),
  created_at timestamptz not null default now()
);

create table loan_installments (
  id bigint generated always as identity primary key,
  loan_id bigint not null references loans (id),
  seq int not null,
  due_date date not null,
  principal numeric(14, 2) not null check (principal >= 0),
  interest numeric(14, 2) not null check (interest >= 0),
  paid_entry_id bigint references entries (id),
  unique (loan_id, seq)
);

create index fixed_assets_entry_idx on fixed_assets (entry_id);
create index spread_schedules_entry_idx on spread_schedules (entry_id);
create index loans_entry_idx on loans (entry_id);
create index loan_installments_loan_idx on loan_installments (loan_id, seq);

alter table fixed_assets enable row level security;
alter table spread_schedules enable row level security;
alter table loans enable row level security;
alter table loan_installments enable row level security;
revoke all on fixed_assets, spread_schedules, loans, loan_installments from public, anon, authenticated;
grant all on fixed_assets, spread_schedules, loans, loan_installments to service_role;

create trigger fixed_assets_no_delete before delete on fixed_assets for each row execute function forbid_change();
create trigger spread_schedules_no_delete before delete on spread_schedules for each row execute function forbid_change();
create trigger loans_no_delete before delete on loans for each row execute function forbid_change();
create trigger loan_installments_no_delete before delete on loan_installments for each row execute function forbid_change();

-- Whether an entry still counts (not Rejected/Cancelled and not reversed by a live reversal).
create function entry_in_force(p_entry_id bigint) returns boolean
language sql stable as $$
  select p_entry_id is null or exists (
    select 1 from entries e
    where e.id = p_entry_id and e.status not in ('Rejected', 'Cancelled')
      and not exists (select 1 from entries r where r.reverses_entry_id = e.id and r.status not in ('Rejected', 'Cancelled'))
  )
$$;

-- insert_entry also stores the template values and the classified entry.
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

-- Saves a register record. p_entry_id is the entry that creates it (null for go-live records).
create function insert_register(p_user uuid, p_register jsonb, p_entry_id bigint) returns bigint
language plpgsql as $$
declare
  d jsonb := p_register -> 'data';
  v_id bigint;
  v_inst jsonb;
begin
  case p_register ->> 'type'
  when 'asset' then
    insert into fixed_assets (name, book, account_code, accum_account_code, profit_center, cost, acquired_date,
                              in_use_date, useful_life_months, depreciated_before_go_live, popup, notes, entry_id, created_by)
    values (d ->> 'name', (d ->> 'book')::book, d ->> 'account_code', d ->> 'accum_account_code',
            (d ->> 'profit_center')::profit_center, (d ->> 'cost')::numeric, (d ->> 'acquired_date')::date,
            (d ->> 'in_use_date')::date, (d ->> 'useful_life_months')::int,
            coalesce((d ->> 'depreciated_before_go_live')::numeric, 0), coalesce((d ->> 'popup')::boolean, false),
            d ->> 'notes', p_entry_id, p_user)
    returning id into v_id;
  when 'spread' then
    insert into spread_schedules (kind, name, book, asset_account, expense_account, profit_center, total, start_month,
                                  months, amortized_before_go_live, entry_id, created_by)
    values (d ->> 'kind', d ->> 'name', (d ->> 'book')::book, d ->> 'asset_account', d ->> 'expense_account',
            (d ->> 'profit_center')::profit_center, (d ->> 'total')::numeric, (d ->> 'start_month')::date,
            (d ->> 'months')::int, coalesce((d ->> 'amortized_before_go_live')::numeric, 0), p_entry_id, p_user)
    returning id into v_id;
  when 'loan' then
    if exists (select 1 from loans l where l.account_code = d ->> 'account_code' and entry_in_force(l.entry_id)) then
      raise exception 'Account % already has a loan; add a new Loans Payable account for this loan', d ->> 'account_code'
        using errcode = 'P0001';
    end if;
    insert into loans (name, lender_party_id, lender_name, account_code, interest_account, book, principal, annual_rate,
                       term_months, start_date, informal, notes, entry_id, created_by)
    values (d ->> 'name', d ->> 'lender_party_id', d ->> 'lender_name', d ->> 'account_code', d ->> 'interest_account',
            coalesce((d ->> 'book')::book, 'Store'), (d ->> 'principal')::numeric,
            coalesce((d ->> 'annual_rate')::numeric, 0), (d ->> 'term_months')::int, (d ->> 'start_date')::date,
            coalesce((d ->> 'informal')::boolean, false), d ->> 'notes', p_entry_id, p_user)
    returning id into v_id;
    for v_inst in select * from jsonb_array_elements(d -> 'installments') loop
      insert into loan_installments (loan_id, seq, due_date, principal, interest)
      values (v_id, (v_inst ->> 'seq')::int, (v_inst ->> 'due_date')::date, (v_inst ->> 'principal')::numeric,
              (v_inst ->> 'interest')::numeric);
    end loop;
  when 'loan_payment' then
    update loan_installments i set paid_entry_id = p_entry_id
    where i.id = (d ->> 'installment_id')::bigint
      and (i.paid_entry_id is null or not entry_in_force(i.paid_entry_id))
    returning i.id into v_id;
    if v_id is null then
      raise exception 'That installment is already paid' using errcode = 'P0001';
    end if;
  else
    raise exception 'Unknown register type %', p_register ->> 'type' using errcode = 'P0001';
  end case;

  insert into audit_log (user_id, action, entity, entity_id, details)
  values (p_user, 'Create', p_register ->> 'type', v_id::text, jsonb_build_object('entry_id', p_entry_id));
  return v_id;
end $$;

-- Creates entries (grouped when more than one) and their register record in one step.
create function create_entries_with_register(p_user uuid, p_entries jsonb, p_register jsonb)
returns jsonb
language plpgsql as $$
declare
  v_ids bigint[];
begin
  v_ids := create_entries(p_user, p_entries, true);
  return jsonb_build_object('entry_ids', v_ids, 'register_id', insert_register(p_user, p_register, v_ids[1]));
end $$;

-- Go-live records (assets, prepaids, loans existing on Oct 31, 2026), matched by the opening balances.
create function create_register(p_user uuid, p_register jsonb) returns bigint
language plpgsql as $$
begin
  perform set_actor(p_user);
  if user_role(p_user) is distinct from 'Owner' then
    raise exception 'Only an Owner records go-live assets, prepaids and loans' using errcode = 'P0001';
  end if;
  return insert_register(p_user, p_register, null);
end $$;

-- Loans in force with their next unpaid installment (for #34 and the Loan Tracker).
create function open_loans()
returns table (id bigint, name text, account_code text, interest_account text, book book,
               next_id bigint, next_seq int, next_due date, next_principal numeric, next_interest numeric)
language sql stable as $$
  select l.id, l.name, l.account_code, l.interest_account, l.book,
         n.id, n.seq, n.due_date, n.principal, n.interest
  from loans l
  left join lateral (
    select i.id, i.seq, i.due_date, i.principal, i.interest from loan_installments i
    where i.loan_id = l.id and (i.paid_entry_id is null or not entry_in_force(i.paid_entry_id))
    order by i.seq limit 1
  ) n on true
  where entry_in_force(l.entry_id)
  order by l.name
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
