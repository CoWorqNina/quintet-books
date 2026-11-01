-- Behaviour tests for 0007_loans_straight_line.sql. Runs after statements_test.sql.

\set kai '\'00000000-0000-0000-0000-00000000000b\''
\set nina '\'00000000-0000-0000-0000-00000000000a\''

-- Go-live loan: 3 rows, the first paid before go-live
select create_register(:nina, '{"type":"loan","data":{"name":"UB test","lender_name":"UB","account_code":"2210","interest_account":"7510",
  "principal":300,"term_months":3,"start_date":"2026-10-31","installment_amount":110,
  "installments":[{"seq":1,"due_date":"2026-10-12","principal":100,"interest":10,"paid_before_go_live":true},
                  {"seq":2,"due_date":"2027-04-12","principal":100,"interest":10},
                  {"seq":3,"due_date":"2027-05-12","principal":100,"interest":10}]}}') as loan \gset
select pg_temp.check((select next_seq from open_loans() where id = :loan) = 2, 'rows paid before go-live count as paid');
select pg_temp.check((select next_interest_recorded from open_loans() where id = :loan) = false, 'next row interest not yet recorded');
select pg_temp.expect_error(format($$select create_register(%L, '{"type":"loan","data":{"name":"bad","lender_name":"x","account_code":"2240","interest_account":"7530",
  "principal":300,"term_months":1,"start_date":"2026-10-31","installments":[{"seq":1,"due_date":"2026-12-01","principal":299,"interest":1}]}}')$$, :nina), 'add up to the loan');

-- Month-end accrual links the row; it can't be accrued twice
select min(id) as row2 from loan_installments where loan_id = :loan and seq = 2 \gset
select create_entries_with_register(:nina,
  '[{"kind":"Adjusting","book":"Store","entry_date":"2027-04-30","reason":"Interest accrual","form":{"generated":"interest","period":"2027-04"},
     "lines":[{"account_code":"7510","debit":10,"profit_center":"GGC"},{"account_code":"2250","credit":10,"party_id":"loan:1"}]}]',
  format('{"type":"loan_interest","data":{"installment_ids":[%s]}}', :row2)::jsonb) as acc \gset
select pg_temp.check((select next_interest_recorded from open_loans() where id = :loan), 'accrual records the row''s interest');
select pg_temp.expect_error(format($$select create_entries_with_register(%L,
  '[{"kind":"Adjusting","book":"Store","entry_date":"2027-04-30","reason":"x","lines":[{"account_code":"7510","debit":1,"profit_center":"GGC"},{"account_code":"2250","credit":1}]}]',
  '{"type":"loan_interest","data":{"installment_ids":[%s]}}')$$, :nina, :row2), 'already recorded');
select cancel_entry(:nina, (:'acc'::jsonb -> 'entry_ids' ->> 0)::bigint);
select pg_temp.check(not (select next_interest_recorded from open_loans() where id = :loan), 'a cancelled accrual frees the row');

select 'ALL LOAN TESTS PASSED' as result;
