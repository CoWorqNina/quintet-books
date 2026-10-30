-- Behaviour tests for 0002_daily_reports.sql. Runs after ledger_test.sql (reuses its users).

\set sup '\'00000000-0000-0000-0000-00000000000c\''
\set kai '\'00000000-0000-0000-0000-00000000000b\''

select create_daily_report(:sup,
  '{"business_date":"2026-11-10","profit_center":"GGC","pos":{"net":100},"drawer":{"actual":100}}',
  '[{"kind":"Template","transaction_type":1,"book":"Store","profit_center":"GGC","entry_date":"2026-11-10",
     "lines":[{"account_code":"1110","debit":100},{"account_code":"4100","credit":100,"profit_center":"GGC"}]},
    {"kind":"Template","transaction_type":2,"book":"Store","profit_center":"GGC","entry_date":"2026-11-10",
     "lines":[{"account_code":"1150","debit":50},{"account_code":"4110","credit":50,"profit_center":"GGC"}]}]'
) as dr \gset
select (:'dr'::jsonb ->> 'report_id')::bigint as rid \gset

select pg_temp.check(count(*) = 2 and bool_and(status = 'Submitted') and bool_and(group_id is null)
  and bool_and(profit_center = 'GGC'), 'report entries are Submitted, linked, ungrouped, tagged GGC')
from entries where daily_report_id = :rid;

select pg_temp.expect_error($$select create_daily_report('00000000-0000-0000-0000-00000000000c',
  '{"business_date":"2026-11-10","profit_center":"GGC","pos":{},"drawer":{}}', '[]')$$, 'already exists');

select pg_temp.expect_error($$select create_daily_report('00000000-0000-0000-0000-00000000000c',
  '{"business_date":"2026-11-10","profit_center":"The Nest","pos":{},"drawer":{}}',
  '[{"kind":"Template","transaction_type":1,"book":"Store","entry_date":"2026-11-10",
     "lines":[{"account_code":"1156","debit":10},{"account_code":"4100","credit":9}]}]')$$, 'does not balance');
select pg_temp.check(not exists (select 1 from daily_reports where profit_center = 'The Nest'),
  'a failing entry leaves no report behind');

select approve_entries(:kai, array(select id from entries where daily_report_id = :rid and transaction_type = 2));
select pg_temp.expect_error(format('select cancel_daily_report(%L, %s, %L)', :sup, :rid, 'typo'), 'reverse them instead');

select create_daily_report(:sup,
  '{"business_date":"2026-11-11","profit_center":"GGC","pos":{},"drawer":{}}',
  '[{"kind":"Template","transaction_type":1,"book":"Store","profit_center":"GGC","entry_date":"2026-11-11",
     "lines":[{"account_code":"1110","debit":70},{"account_code":"4100","credit":70,"profit_center":"GGC"}]}]'
) as dr2 \gset
select pg_temp.expect_error(format('select cancel_daily_report(%L, %s, %L)', :sup, (:'dr2'::jsonb ->> 'report_id'), ''), 'needs a reason');
select cancel_daily_report(:sup, (:'dr2'::jsonb ->> 'report_id')::bigint, 'Wrong date');
select pg_temp.check(bool_and(status = 'Cancelled'), 'cancelling a report cancels its entries')
from entries where daily_report_id = (:'dr2'::jsonb ->> 'report_id')::bigint;
select create_daily_report(:sup,
  '{"business_date":"2026-11-11","profit_center":"GGC","pos":{},"drawer":{}}',
  '[{"kind":"Template","transaction_type":1,"book":"Store","profit_center":"GGC","entry_date":"2026-11-11",
     "lines":[{"account_code":"1110","debit":75},{"account_code":"4100","credit":75,"profit_center":"GGC"}]}]');
select pg_temp.check(count(*) = 2, 'the day can be re-entered after cancelling')
from daily_reports where business_date = '2026-11-11';

select 'ALL DAILY REPORT TESTS PASSED' as result;
