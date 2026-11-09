-- Behaviour tests for 0013_edit_daily_report.sql. Runs after open_items_test.sql.

\set nina '\'00000000-0000-0000-0000-00000000000a\''
\set kai '\'00000000-0000-0000-0000-00000000000b\''

select (create_daily_report(:nina, '{"business_date":"2027-09-01","profit_center":"GGC","pos":{"net":100},"drawer":{}}',
  '[{"kind":"Template","transaction_type":1,"book":"Store","entry_date":"2027-09-01","description":"Cash sales",
     "lines":[{"account_code":"1110","debit":100},{"account_code":"4100","credit":100,"profit_center":"GGC"}]}]') ->> 'report_id')::bigint as r1 \gset

-- Edit: the old report and its entries are cancelled, the corrected one takes the day
select (replace_daily_report(:nina, :r1, '{"business_date":"2027-09-01","profit_center":"GGC","pos":{"net":120},"drawer":{}}',
  '[{"kind":"Template","transaction_type":1,"book":"Store","entry_date":"2027-09-01","description":"Cash sales",
     "lines":[{"account_code":"1110","debit":120},{"account_code":"4100","credit":120,"profit_center":"GGC"}]}]') ->> 'report_id')::bigint as r2 \gset
select pg_temp.check((select status from daily_reports where id = :r1) = 'Cancelled', 'the edited report is cancelled');
select pg_temp.check((select count(*) from entries where daily_report_id = :r1 and status = 'Cancelled') = 1, 'its entries are cancelled');
select pg_temp.check((select (pos ->> 'net')::numeric from daily_reports where id = :r2 and status = 'Active') = 120, 'the corrected report is the active one');

-- Once an entry is approved, the report can't be edited (reverse instead)
select approve_entries(:kai, array(select id from entries where daily_report_id = :r2));
select pg_temp.expect_error(format($$select replace_daily_report(%L, %s, '{"business_date":"2027-09-01","profit_center":"GGC","pos":{},"drawer":{}}', '[]')$$, :nina, :r2), 'already approved');

select 'ALL EDIT TESTS PASSED' as result;
