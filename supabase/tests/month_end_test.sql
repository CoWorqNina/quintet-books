-- Behaviour tests for 0005_month_end.sql. Runs after views_test.sql.

\set kai '\'00000000-0000-0000-0000-00000000000b\''
\set nina '\'00000000-0000-0000-0000-00000000000a\''

select create_entries(:nina, '[{"kind":"Adjusting","book":"Store","entry_date":"2027-02-28","reason":"Month-end depreciation",
  "form":{"generated":"depreciation","period":"2027-02"},
  "lines":[{"account_code":"6810","debit":1000,"profit_center":"GGC"},{"account_code":"1592","credit":1000,"party_id":"asset:1","party_name":"Fryer"}]}]', true) as dep \gset
select pg_temp.check((select net from booked_by_party('asset:', '2027-02-28') where account_code = '1592') = -1000, 'submitted depreciation counts as booked');
select pg_temp.check((select count(*) from generated_entries('2027-02')) = 1, 'generated entry is listed for its month');
select cancel_entry(:nina, (:'dep'::bigint[])[1]);
select pg_temp.check((select count(*) from generated_entries('2027-02')) = 0, 'a cancelled one is not');
select pg_temp.check((select count(*) from booked_by_party('asset:', '2027-02-28')) = 0, 'and books nothing');

insert into inventory_counts (book, profit_center, period_key, lines, counted_by)
values ('Store', 'GGC', '2027-02', '[{"item":"Rice","unit":"kg","quantity":10,"unit_value":50,"account":"5100"}]', :nina);
select pg_temp.expect_error($$insert into inventory_counts (book, profit_center, period_key, counted_by)
  values ('Store', 'GGC', '2027-02', '00000000-0000-0000-0000-00000000000a')$$, 'duplicate key');
select pg_temp.expect_error($$delete from inventory_counts$$, 'never deleted');
insert into reconciliations (account_code, book, period_key, statement_balance, ledger_balance, prepared_by)
values ('1140', 'Store', '2027-02', 1, 1, :nina);
select pg_temp.expect_error($$insert into reconciliations (account_code, book, period_key, statement_balance, ledger_balance, prepared_by) values ('1140', 'Store', '2026-10', 1, 1, '00000000-0000-0000-0000-00000000000a')$$, 'is closed');
select pg_temp.check(true, 'reconciliation saved');

select 'ALL MONTH-END TESTS PASSED' as result;
