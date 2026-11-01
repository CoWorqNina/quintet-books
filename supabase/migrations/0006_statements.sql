-- Phase 5: financial statements. Read-only functions over Approved entries.
-- Run after 0005_month_end.sql.

-- Income and expense movements per month, book, account and profit center, for the Income
-- Statement (monthly, year to date, month by month). Year-end Closing entries are left out.
-- "intercompany" marks Commissary transfer billings (#20) on both sides, removed in
-- whole-business and GGC-as-a-whole views.
create function statement_totals(p_from date, p_to date)
returns table (period_key text, book book, account_code text, profit_center profit_center,
               intercompany boolean, debit numeric, credit numeric)
language sql stable as $$
  select e.period_key, e.book, l.account_code, l.profit_center,
         coalesce(l.template_line in ('20.billing', '20.cogs'), false),
         sum(l.debit), sum(l.credit)
  from entry_lines l
  join entries e on e.id = l.entry_id
  where e.status = 'Approved' and e.kind <> 'Closing' and e.entry_date between p_from and p_to
  group by 1, 2, 3, 4, 5
$$;

-- Every line of the approved entries that move one of the given cash accounts, for the
-- direct-method Cash Flow Statement.
create function cash_entry_lines(p_from date, p_to date, p_cash text[])
returns table (entry_id bigint, entry_date date, book book, account_code text, profit_center profit_center,
               debit numeric, credit numeric)
language sql stable as $$
  select e.id, e.entry_date, e.book, l.account_code, l.profit_center, l.debit, l.credit
  from entries e
  join entry_lines l on l.entry_id = e.id
  where e.status = 'Approved' and e.entry_date between p_from and p_to
    and exists (select 1 from entry_lines c where c.entry_id = e.id and c.account_code = any (p_cash))
  order by e.entry_date, e.id, l.line_no
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
