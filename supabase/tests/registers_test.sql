-- Behaviour tests for 0003_registers.sql. Runs after daily_reports_test.sql.

\set sup '\'00000000-0000-0000-0000-00000000000c\''
\set kai '\'00000000-0000-0000-0000-00000000000b\''
\set nina '\'00000000-0000-0000-0000-00000000000a\''

-- Asset purchase with its register row, created in one step
select create_entries_with_register(:nina,
  '[{"kind":"Template","transaction_type":29,"book":"Store","profit_center":"GGC","entry_date":"2026-11-12",
     "form":{"template":29},
     "lines":[{"account_code":"1520","debit":18000},{"account_code":"1140","credit":18000}]}]',
  '{"type":"asset","data":{"name":"Fryer","book":"Store","account_code":"1520","accum_account_code":"1592",
     "profit_center":"GGC","cost":18000,"acquired_date":"2026-11-12","in_use_date":"2026-11-12","useful_life_months":18}}'
) as a \gset
select pg_temp.check(e.form is not null and fa.entry_id = e.id, 'asset row is linked to its entry and the form is kept')
from fixed_assets fa join entries e on e.id = fa.entry_id where fa.id = (:'a'::jsonb ->> 'register_id')::bigint;

select pg_temp.expect_error($$select create_entries_with_register('00000000-0000-0000-0000-00000000000a',
  '[{"kind":"Template","transaction_type":29,"book":"Store","entry_date":"2026-11-12",
     "lines":[{"account_code":"1520","debit":10},{"account_code":"1140","credit":9}]}]',
  '{"type":"asset","data":{"name":"x","book":"Store","account_code":"1520","accum_account_code":"1592","profit_center":"GGC","cost":10,"acquired_date":"2026-11-12","in_use_date":"2026-11-12","useful_life_months":18}}')$$,
  'does not balance');
select pg_temp.check((select count(*) from fixed_assets) = 1, 'a failed entry leaves no register row');

-- Loan with schedule; one loan per Loans Payable account
select create_entries_with_register(:nina,
  '[{"kind":"Template","transaction_type":33,"book":"Store","profit_center":"GGC","entry_date":"2026-11-02",
     "lines":[{"account_code":"1140","debit":99000},{"account_code":"7160","debit":1000,"profit_center":"GGC"},{"account_code":"2230","credit":100000}]}]',
  '{"type":"loan","data":{"name":"Test loan","lender_name":"Lender","account_code":"2230","interest_account":"7530","principal":100000,
     "annual_rate":12,"term_months":2,"start_date":"2026-11-02",
     "installments":[{"seq":1,"due_date":"2026-12-02","principal":49751.24,"interest":1000},{"seq":2,"due_date":"2027-01-02","principal":50248.76,"interest":502.49}]}}'
) as l \gset
select (:'l'::jsonb ->> 'register_id')::bigint as loan_id \gset
select pg_temp.check((select count(*) from loan_installments where loan_id = :loan_id) = 2, 'loan schedule saved');
select pg_temp.expect_error(format($$select create_register(%L, '{"type":"loan","data":{"name":"Dup","lender_name":"x","account_code":"2230","interest_account":"7530","principal":1,"term_months":1,"start_date":"2026-10-31","installments":[]}}')$$, :nina),
  'already has a loan');

-- Paying an installment links it; it can't be paid twice while the payment is in force
select min(id) as inst from loan_installments where loan_id = :loan_id \gset
select create_entries_with_register(:nina,
  '[{"kind":"Template","transaction_type":34,"book":"Store","profit_center":"GGC","entry_date":"2026-12-02",
     "lines":[{"account_code":"2230","debit":49751.24},{"account_code":"7530","debit":1000,"profit_center":"GGC"},{"account_code":"1140","credit":50751.24}]}]',
  format('{"type":"loan_payment","data":{"installment_id":%s}}', :inst)::jsonb) as p \gset
select pg_temp.expect_error(format($$select create_entries_with_register('00000000-0000-0000-0000-00000000000a',
  '[{"kind":"Template","transaction_type":34,"book":"Store","entry_date":"2026-12-02","lines":[{"account_code":"2230","debit":1},{"account_code":"1140","credit":1}]}]',
  '{"type":"loan_payment","data":{"installment_id":%s}}')$$, :inst), 'already paid');
select cancel_entry(:nina, (:'p'::jsonb -> 'entry_ids' ->> 0)::bigint);
select create_entries_with_register(:nina,
  '[{"kind":"Template","transaction_type":34,"book":"Store","entry_date":"2026-12-02","lines":[{"account_code":"2230","debit":1},{"account_code":"1140","credit":1}]}]',
  format('{"type":"loan_payment","data":{"installment_id":%s}}', :inst)::jsonb);
select pg_temp.check(true, 'a cancelled payment frees the installment');
select pg_temp.check((select next_seq from open_loans() where id = :loan_id) = 2, 'open_loans shows the next unpaid installment');

-- Go-live records: owners only, no entry
select pg_temp.expect_error(format($$select create_register(%L, '{"type":"spread","data":{"kind":"Prepaid","name":"x","book":"Store","asset_account":"1430","expense_account":"6823","profit_center":"GGC","total":1,"start_month":"2026-10-01","months":2}}')$$, :sup),
  'Only an Owner');
select create_register(:nina, '{"type":"spread","data":{"kind":"Deferred charge","name":"Assume Price","book":"Store","asset_account":"1610","expense_account":"6821","profit_center":"Shared","total":134935,"start_month":"2026-04-01","months":24,"amortized_before_go_live":39356.03}}');
select pg_temp.check(entry_in_force(null), 'go-live records with no entry are in force');

-- A reversed asset purchase takes the asset out of force
select approve_entries(:kai, array[(select entry_id from fixed_assets limit 1)]);
select reverse_entry(:sup, (select entry_id from fixed_assets limit 1), 'Wrong supplier') as rev \gset
select pg_temp.check(not entry_in_force((select entry_id from fixed_assets limit 1)), 'reversed asset purchase is no longer in force');

select 'ALL REGISTER TESTS PASSED' as result;
