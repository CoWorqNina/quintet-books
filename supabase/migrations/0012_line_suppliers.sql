-- Supplier costs: a purchase can name a different supplier on each line (one market run,
-- several suppliers), so the line's own supplier is used first, then the entry's.
-- Run after 0011_partner_role.sql.

create or replace function cost_lines(p_accounts text[], p_from date, p_to date)
returns table (entry_id bigint, entry_date date, book book, account_code text, supplier text,
               quantity numeric, unit text, unit_price numeric, amount numeric)
language sql stable as $$
  select e.id, e.entry_date, e.book, l.account_code,
         coalesce(case when l.party_id like 'rec%' then l.party_name end,
                  (select s.party_name from entry_lines s
                    where s.entry_id = e.id and s.party_id like 'rec%' and s.line_no <> l.line_no
                    order by s.line_no limit 1)),
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
