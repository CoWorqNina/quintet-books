-- Phase 3: read-only ledger views (General Ledger, T-accounts, Trial Balance, sub-ledgers).
-- Only Approved entries count. Run after 0003_registers.sql.

-- Totals per book, account and profit center up to p_to, split into before the fiscal year
-- (p_year_start) and within it, so the app can carry balance sheet accounts from the start
-- and take income statement accounts year-to-date.
--   p_mode 'unadjusted'   leaves out the Adjusting entries of p_to's month and this year's Closing entries
--          'adjusted'     leaves out this year's Closing entries
--          'post-closing' includes everything
create function account_totals(p_to date, p_year_start date, p_mode text default 'adjusted')
returns table (book book, account_code text, profit_center profit_center,
               prior_debit numeric, prior_credit numeric, year_debit numeric, year_credit numeric)
language sql stable as $$
  select e.book, l.account_code, l.profit_center,
         coalesce(sum(l.debit) filter (where e.entry_date < p_year_start), 0),
         coalesce(sum(l.credit) filter (where e.entry_date < p_year_start), 0),
         coalesce(sum(l.debit) filter (where e.entry_date >= p_year_start), 0),
         coalesce(sum(l.credit) filter (where e.entry_date >= p_year_start), 0)
  from entry_lines l
  join entries e on e.id = l.entry_id
  where e.status = 'Approved'
    and e.entry_date <= p_to
    and not (p_mode = 'unadjusted' and e.kind = 'Adjusting' and e.entry_date >= date_trunc('month', p_to)::date)
    and not (p_mode <> 'post-closing' and e.kind = 'Closing' and e.entry_date >= p_year_start)
  group by e.book, l.account_code, l.profit_center
$$;

-- Approved lines of one account (one book, or both when p_book is null) between two dates,
-- with the entry they belong to, in posting order.
create function gl_lines(p_account text, p_book book, p_from date, p_to date)
returns table (entry_id bigint, line_no smallint, entry_date date, kind entry_kind, transaction_type smallint,
               book book, description text, source_document text, profit_center profit_center,
               party_name text, memo text, debit numeric, credit numeric, attachments jsonb)
language sql stable as $$
  select e.id, l.line_no, e.entry_date, e.kind, e.transaction_type, e.book, e.description, e.source_document,
         l.profit_center, l.party_name, l.memo, l.debit, l.credit, e.attachments
  from entry_lines l
  join entries e on e.id = l.entry_id
  where e.status = 'Approved' and l.account_code = p_account
    and (p_book is null or e.book = p_book)
    and e.entry_date between p_from and p_to
  order by e.entry_date, e.id, l.line_no
$$;

-- Balance of one account before p_before (from p_since when given, e.g. the fiscal year start
-- for income statement accounts), debit-positive.
create function gl_opening(p_account text, p_book book, p_before date, p_since date default null)
returns numeric
language sql stable as $$
  select coalesce(sum(l.debit - l.credit), 0)
  from entry_lines l
  join entries e on e.id = l.entry_id
  where e.status = 'Approved' and l.account_code = p_account
    and (p_book is null or e.book = p_book)
    and e.entry_date < p_before
    and (p_since is null or e.entry_date >= p_since)
$$;

-- Approved lines of the given accounts up to p_to, for per-party balances and aging.
create function party_lines(p_accounts text[], p_to date)
returns table (book book, account_code text, party_id text, party_name text, entry_id bigint,
               entry_date date, description text, debit numeric, credit numeric)
language sql stable as $$
  select e.book, l.account_code, l.party_id, l.party_name, e.id, e.entry_date, e.description, l.debit, l.credit
  from entry_lines l
  join entries e on e.id = l.entry_id
  where e.status = 'Approved' and l.account_code = any (p_accounts) and e.entry_date <= p_to
  order by e.entry_date, e.id, l.line_no
$$;

-- Purchases with quantity and unit price on the given accounts, with the entry's supplier.
create function cost_lines(p_accounts text[], p_from date, p_to date)
returns table (entry_id bigint, entry_date date, book book, account_code text, supplier text,
               quantity numeric, unit text, unit_price numeric, amount numeric)
language sql stable as $$
  select e.id, e.entry_date, e.book, l.account_code,
         (select s.party_name from entry_lines s
           where s.entry_id = e.id and s.party_id like 'rec%' and s.line_no <> l.line_no
           order by s.line_no limit 1),
         l.quantity, l.unit, l.unit_price, l.debit - l.credit
  from entry_lines l
  join entries e on e.id = l.entry_id
  where e.status = 'Approved' and e.kind <> 'Reversal' and l.account_code = any (p_accounts)
    and l.quantity is not null and e.entry_date between p_from and p_to
    and not exists (select 1 from entries r where r.reverses_entry_id = e.id and r.status = 'Approved')
  order by e.entry_date, e.id, l.line_no
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
