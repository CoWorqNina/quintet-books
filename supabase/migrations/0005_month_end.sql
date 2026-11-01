-- Phase 4: month-end. Amounts already booked per register record (for generated adjusting
-- entries), inventory counts, bank and cash reconciliations, and the close step.
-- Run after 0004_ledger_views.sql.

-- An entry "counts" for month-end work while it is not Rejected or Cancelled. A reversal is
-- itself such an entry, so reversed amounts net out.
create function live_entry(p_status entry_status) returns boolean
language sql immutable as $$ select p_status not in ('Rejected', 'Cancelled') $$;

-- Net amount (debit - credit) booked per register party ("asset:12", "spread:3", "loan:5") and
-- account, counting entries waiting for approval too, so nothing is generated twice.
create function booked_by_party(p_prefix text, p_to date)
returns table (party_id text, account_code text, book book, net numeric)
language sql stable as $$
  select l.party_id, l.account_code, e.book, sum(l.debit - l.credit)
  from entry_lines l
  join entries e on e.id = l.entry_id
  where live_entry(e.status) and l.party_id like p_prefix || '%' and e.entry_date <= p_to
  group by l.party_id, l.account_code, e.book
$$;

-- Gross pay recorded by payroll entries (#22) in a date range, per book, profit center and account.
create function payroll_gross(p_from date, p_to date)
returns table (book book, profit_center profit_center, account_code text, amount numeric)
language sql stable as $$
  select e.book, l.profit_center, l.account_code, sum(l.debit - l.credit)
  from entry_lines l
  join entries e on e.id = l.entry_id
  where live_entry(e.status) and l.template_line = '22.gross' and e.entry_date between p_from and p_to
  group by e.book, l.profit_center, l.account_code
$$;

-- Month-end entries the app generated for a month (entries.form ->> 'generated'), still in force.
create function generated_entries(p_period text)
returns table (id bigint, book book, generated text, status entry_status)
language sql stable as $$
  select e.id, e.book, e.form ->> 'generated', e.status
  from entries e
  where e.form ->> 'period' = p_period and e.form ? 'generated'
    and live_entry(e.status)
    and not exists (select 1 from entries r where r.reverses_entry_id = e.id and live_entry(r.status))
$$;

-- Inventory counts: one per book, profit center and month. Lines are
-- [{item, unit, quantity, unit_value, account}] where account is the ingredient's COGS account.
create table inventory_counts (
  id bigint generated always as identity primary key,
  book book not null,
  profit_center profit_center not null check (profit_center <> 'Shared'),
  period_key text not null references periods (key),
  lines jsonb not null default '[]',
  notes text,
  entry_id bigint references entries (id),          -- the adjustment entry, once generated
  counted_by uuid not null references app_users (id),
  updated_at timestamptz not null default now(),
  unique (book, profit_center, period_key)
);

-- Bank and cash reconciliations: per cash account and month. items are
-- [{description, amount}] where amount is added to the statement (or count) to reach the ledger.
create table reconciliations (
  id bigint generated always as identity primary key,
  account_code text not null,
  book book not null,
  period_key text not null references periods (key),
  statement_balance numeric(14, 2) not null,
  items jsonb not null default '[]',
  ledger_balance numeric(14, 2) not null,           -- ledger balance when last saved
  attachments jsonb not null default '[]',
  prepared_by uuid not null references app_users (id),
  updated_at timestamptz not null default now(),
  unique (account_code, book, period_key)
);

alter table inventory_counts enable row level security;
alter table reconciliations enable row level security;
revoke all on inventory_counts, reconciliations from public, anon, authenticated;
grant all on inventory_counts, reconciliations to service_role;

-- Counts and reconciliations of a Final month can't change.
create function month_open_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Counts and reconciliations are never deleted' using errcode = 'P0001';
  end if;
  if exists (select 1 from periods p where p.key = new.period_key and p.status = 'Final') then
    raise exception 'Period % is closed', new.period_key using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger inventory_counts_guard before insert or update or delete on inventory_counts
  for each row execute function month_open_guard();
create trigger reconciliations_guard before insert or update or delete on reconciliations
  for each row execute function month_open_guard();

-- Daily reports encoded per day of a month, for the close checklist.
create function daily_report_days(p_period text)
returns table (business_date date, profit_center profit_center)
language sql stable as $$
  select r.business_date, r.profit_center from daily_reports r
  where r.status = 'Active' and to_char(r.business_date, 'YYYY-MM') = p_period
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
