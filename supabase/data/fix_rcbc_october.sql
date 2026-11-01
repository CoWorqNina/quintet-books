-- RCBC (Nina card): installment 6 (due Oct 25, 2026) was NOT paid before go-live.
-- It stays unpaid (Overdue); its interest (660.62) is in the opening balances as 2250 Accrued
-- Interest Payable for this loan, so paying it clears 2250. Run after
-- 0008_loan_interest_before_go_live.sql.
update loan_installments i
set paid_before_go_live = false, interest_before_go_live = true
from loans l
where l.id = i.loan_id and l.account_code = '2220' and i.seq = 6 and i.paid_entry_id is null;

-- Check: 5 paid before go-live; opening 2220 = 149,416.65; interest accrued before go-live = 660.62
select l.name,
       count(*) filter (where i.paid_before_go_live) as paid_before_go_live,
       l.principal - coalesce(sum(i.principal) filter (where i.paid_before_go_live), 0) as opening_loans_payable,
       coalesce(sum(i.interest) filter (where i.interest_before_go_live and not i.paid_before_go_live), 0) as opening_accrued_interest
from loans l join loan_installments i on i.loan_id = l.id
where l.account_code = '2220' group by l.id;
