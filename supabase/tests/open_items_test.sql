-- Behaviour tests for 0009_open_items.sql. Runs after loans_test.sql.

\set kai '\'00000000-0000-0000-0000-00000000000b\''
\set nina '\'00000000-0000-0000-0000-00000000000a\''

-- A credit purchase with a due date, then a payment naming it
select (create_entries(:nina, '[{"kind":"Template","transaction_type":13,"book":"Store","entry_date":"2027-06-01","description":"Credit purchase",
  "lines":[{"account_code":"5130","debit":1000,"profit_center":"GGC"},
           {"account_code":"2100","credit":1000,"party_id":"recMDEI","party_name":"MDEI","memo":"Invoice 7","due_date":"2027-06-16"}]}]'))[1] as bill \gset
select approve_entries(:kai, array[:bill]::bigint[]);
select id as bill_line from entry_lines where entry_id = :bill and account_code = '2100' \gset
select pg_temp.check((select due_date from entry_lines where id = :bill_line) = '2027-06-16', 'payable line keeps its due date');

select (create_entries(:nina, format('[{"kind":"Template","transaction_type":14,"book":"Store","entry_date":"2027-06-10","description":"Payment",
  "lines":[{"account_code":"2100","debit":400,"party_id":"recMDEI","settles_line_id":%s},{"account_code":"1140","credit":400}]}]', :bill_line)::jsonb))[1] as pay \gset
select pg_temp.check((select sum(amount) from pending_settlements(array['2100'])) = 400, 'a submitted payment shows as pending on the bill');
select approve_entries(:kai, array[:pay]::bigint[]);
select pg_temp.check((select count(*) from pending_settlements(array['2100'])) = 0, 'approved payments are no longer pending');
select pg_temp.check((select settles_line_id from party_lines(array['2100'], '2027-12-31') where entry_id = :pay) = :bill_line, 'party_lines returns the bill paid');

-- The settling line must be the same account, other side
select pg_temp.expect_error(format($$select create_entries(%L, '[{"kind":"Template","transaction_type":18,"book":"Store","entry_date":"2027-06-10","description":"x",
  "lines":[{"account_code":"2113","debit":1,"settles_line_id":%s},{"account_code":"1140","credit":1}]}]')$$, :nina, :bill_line), 'same account');
select pg_temp.expect_error(format($$select create_entries(%L, '[{"kind":"Template","transaction_type":18,"book":"Store","entry_date":"2027-06-10","description":"x",
  "lines":[{"account_code":"1140","debit":1},{"account_code":"2100","credit":1,"settles_line_id":%s}]}]')$$, :nina, :bill_line), 'same account');

-- A reversed payment and its reversal drop out of party_lines, so the bill re-opens
select reverse_entry(:nina, :pay, 'Paid the wrong invoice') as rev \gset
select approve_entries(:kai, :'rev'::bigint[]);
select pg_temp.check(not exists (select 1 from party_lines(array['2100'], '2027-12-31') where entry_id = :pay or entry_id = ((:'rev'::bigint[])[1])), 'reversed pair is left out');
select pg_temp.check((select sum(credit - debit) from party_lines(array['2100'], '2027-12-31') where party_id = 'recMDEI') = 1000, 'bill is unpaid again');

-- Editing a draft keeps the settlement
select (create_entries(:nina, format('[{"kind":"Template","transaction_type":14,"book":"Store","entry_date":"2027-06-11","description":"Payment",
  "lines":[{"account_code":"2100","debit":100,"settles_line_id":%s},{"account_code":"1140","credit":100}]}]', :bill_line)::jsonb, false))[1] as draft \gset
select update_entry(:nina, :draft, format('{"book":"Store","entry_date":"2027-06-12","description":"Payment",
  "lines":[{"account_code":"2100","debit":150,"settles_line_id":%s},{"account_code":"1140","credit":150}]}', :bill_line)::jsonb, true);
select pg_temp.check((select amount from pending_settlements(array['2100']) where entry_id = :draft) = 150, 'edited payment still names the bill');

select 'ALL OPEN ITEM TESTS PASSED' as result;

-- 0010: one entry pays several installments of a loan; paying one of them twice fails
select create_register(:nina, '{"type":"loan","data":{"name":"Card loan test","lender_name":"BDO","account_code":"2271","interest_account":"7530",
  "principal":300,"term_months":3,"start_date":"2027-06-01","installment_amount":100,
  "installments":[{"seq":1,"due_date":"2027-07-01","principal":100,"interest":0},{"seq":2,"due_date":"2027-08-01","principal":100,"interest":0},
                  {"seq":3,"due_date":"2027-09-01","principal":100,"interest":0}]}}') as cl \gset
select array_agg(id order by seq) as cl_rows from loan_installments where loan_id = :cl \gset
select create_entries_with_register(:nina,
  '[{"kind":"Template","transaction_type":44,"book":"Store","entry_date":"2027-07-01","description":"Combined",
     "lines":[{"account_code":"2271","debit":200},{"account_code":"1140","credit":200}]}]',
  format('{"type":"loan_payments","data":{"installment_ids":[%s,%s]}}', (:'cl_rows'::bigint[])[1], (:'cl_rows'::bigint[])[2])::jsonb) as comb \gset
select pg_temp.check((select next_seq from open_loans() where id = :cl) = 3, 'one entry pays two installments');
select pg_temp.expect_error(format($$select create_entries_with_register(%L,
  '[{"kind":"Template","transaction_type":44,"book":"Store","entry_date":"2027-07-02","description":"x","lines":[{"account_code":"2271","debit":100},{"account_code":"1140","credit":100}]}]',
  '{"type":"loan_payments","data":{"installment_ids":[%s]}}')$$, :nina, (:'cl_rows'::bigint[])[2]), 'already paid');

select 'ALL COMBINED PAYMENT TESTS PASSED' as result;
