-- Behaviour tests for 0001_ledger.sql. Run on a scratch database after local_stub.sql and the
-- migration; any failed expectation raises and stops the script (psql -v ON_ERROR_STOP=1).

create function pg_temp.expect_error(p_sql text, p_pattern text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'Expected error matching "%" but statement succeeded: %', p_pattern, p_sql;
exception when others then
  if sqlerrm not ilike '%' || p_pattern || '%' then
    raise exception 'Expected error matching "%", got: %', p_pattern, sqlerrm;
  end if;
end $$;

create function pg_temp.check(p_ok boolean, p_what text) returns void
language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'Check failed: %', p_what; end if;
  raise notice 'ok: %', p_what;
end $$;

insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a', 'nina@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'kai@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'sup@example.com');
insert into app_users (id, email, full_name, role, books, profit_centers) values
  ('00000000-0000-0000-0000-00000000000a', 'nina@example.com', 'Nina', 'Owner', '{Store,Commissary}', '{GGC,"The Nest"}'),
  ('00000000-0000-0000-0000-00000000000b', 'kai@example.com', 'Kai', 'Owner', '{Store,Commissary}', '{GGC,"The Nest"}'),
  ('00000000-0000-0000-0000-00000000000c', 'sup@example.com', 'Sup', 'Supervisor', '{Store}', '{GGC}');

\set nina '\'00000000-0000-0000-0000-00000000000a\''
\set kai '\'00000000-0000-0000-0000-00000000000b\''
\set sup '\'00000000-0000-0000-0000-00000000000c\''

-- Daily cash sales by the Supervisor: 1110 Dr 1000 / 4100 Cr 1000
select create_entries(:sup, '[{"kind":"Template","transaction_type":1,"book":"Store","entry_date":"2026-11-02",
  "description":"Daily cash sales","lines":[
   {"account_code":"1110","debit":1000},
   {"account_code":"4100","credit":1000,"profit_center":"GGC"}]}]') as e1 \gset
select pg_temp.check(status = 'Submitted', 'balanced entry is created Submitted') from entries where id = (:'e1'::bigint[])[1];

select pg_temp.expect_error($$select create_entries('00000000-0000-0000-0000-00000000000c',
  '[{"kind":"Template","transaction_type":1,"book":"Store","entry_date":"2026-11-02","lines":[
   {"account_code":"1110","debit":1000},{"account_code":"4100","credit":900,"profit_center":"GGC"}]}]')$$,
  'does not balance');
select pg_temp.check((select count(*) from entries) = 1, 'failed create leaves nothing behind');

select pg_temp.expect_error($$select create_entries('00000000-0000-0000-0000-00000000000c',
  '[{"kind":"Template","transaction_type":1,"book":"Store","entry_date":"2026-11-02","lines":[
   {"account_code":"1110","debit":100,"credit":100},{"account_code":"4100","credit":0}]}]')$$,
  'entry_lines_one_side');

select pg_temp.expect_error($$select create_entries('00000000-0000-0000-0000-00000000000a',
  '[{"kind":"Free-form","book":"Store","entry_date":"2026-11-02","lines":[
   {"account_code":"1110","debit":5},{"account_code":"4100","credit":5}]}]')$$,
  'entries_reason_required');

-- Approval rules
select pg_temp.expect_error(format('select approve_entries(%L, %L)', :sup, :'e1'::bigint[]), 'Only an active Owner');
select create_entries(:nina, '[{"kind":"Free-form","book":"Store","entry_date":"2026-11-03","reason":"test",
  "lines":[{"account_code":"1140","debit":50},{"account_code":"1110","credit":50}]}]') as e2 \gset
select pg_temp.expect_error(format('select approve_entries(%L, %L)', :nina, :'e2'::bigint[]), 'entries_no_self_approval');
select approve_entries(:kai, :'e1'::bigint[] || :'e2'::bigint[]);
select pg_temp.check((select count(*) from entries where status = 'Approved') = 2, 'owner approves others'' entries in a batch');

select pg_temp.check(debits = 1000 and credits = 50, 'balances posted for 1110')
from account_period_balances where period_key = '2026-11' and book = 'Store' and account_code = '1110';
select pg_temp.check(credits = 1000 and profit_center = 'GGC', 'revenue balance keeps profit center')
from account_period_balances where account_code = '4100';

-- Posted entries are frozen
select pg_temp.expect_error(format('update entries set description = %L where id = %s', 'x', (:'e1'::bigint[])[1]), 'cannot change');
select pg_temp.expect_error(format('delete from entries where id = %s', (:'e1'::bigint[])[1]), 'never deleted');
select pg_temp.expect_error(format('insert into entry_lines (entry_id, line_no, account_code, debit) values (%s, 9, %L, 1)', (:'e1'::bigint[])[1], '1110'), 'cannot change');
select pg_temp.expect_error(format('update entry_lines set debit = 1 where entry_id = %s', (:'e1'::bigint[])[1]), 'cannot change');
select pg_temp.expect_error('delete from audit_log', 'cannot be changed');

-- Two-book group (#20 Commissary Transfer Billing) posts together
select create_entries(:sup, '[
  {"kind":"Template","transaction_type":20,"book":"Commissary","entry_date":"2026-11-04","lines":[
    {"account_code":"1280","debit":300},{"account_code":"4190","credit":300,"profit_center":"GGC"}]},
  {"kind":"Template","transaction_type":20,"book":"Store","entry_date":"2026-11-04","lines":[
    {"account_code":"5130","debit":300,"profit_center":"GGC"},{"account_code":"2180","credit":300}]}]') as g \gset
select approve_entries(:nina, array[(:'g'::bigint[])[1]]);
select pg_temp.check((select count(*) from entries where id = any (:'g'::bigint[]) and status = 'Approved') = 2,
  'approving one entry of a group approves the whole group');
select pg_temp.check(
  (select debits from account_period_balances where book = 'Commissary' and account_code = '1280') =
  (select credits from account_period_balances where book = 'Store' and account_code = '2180'),
  'Due from Store equals Due to Commissary');

-- Reject, edit, resubmit
select create_entries(:sup, '[{"kind":"Template","transaction_type":11,"book":"Store","entry_date":"2026-11-05",
  "lines":[{"account_code":"6610","debit":120,"profit_center":"GGC"},{"account_code":"1120","credit":120}]}]') as e3 \gset
select pg_temp.expect_error(format('select reject_entry(%L, %s, %L)', :nina, (:'e3'::bigint[])[1], ''), 'entries_rejection_has_reason');
select reject_entry(:nina, (:'e3'::bigint[])[1], 'Receipt missing');
select update_entry(:sup, (:'e3'::bigint[])[1], '{"book":"Store","entry_date":"2026-11-05","source_document":"OR 123",
  "lines":[{"account_code":"6610","debit":125,"profit_center":"GGC"},{"account_code":"1120","credit":125}]}');
select pg_temp.check(status = 'Submitted' and source_document = 'OR 123' and rejection_reason is null,
  'rejected entry can be fixed and resubmitted') from entries where id = (:'e3'::bigint[])[1];
select pg_temp.check((select count(*) from audit_log where entity_id = (:'e3'::bigint[])[1]::text and action = 'Edit') = 1,
  'edit keeps the previous version in the audit log');

-- Reversal with correction
select reverse_entry(:sup, (:'e1'::bigint[])[1], 'Wrong amount', '[{"kind":"Template","transaction_type":1,"book":"Store",
  "entry_date":"2026-11-02","lines":[{"account_code":"1110","debit":1100},{"account_code":"4100","credit":1100,"profit_center":"GGC"}]}]') as r \gset
select pg_temp.check((select count(*) from entries where id = any (:'r'::bigint[]) and status = 'Submitted') = 2,
  'reversal and correction are created Submitted');
select pg_temp.expect_error(format('select reverse_entry(%L, %s, %L)', :sup, (:'e1'::bigint[])[1], 'again'), 'already has a reversal');
select approve_entries(:kai, :'r'::bigint[]);
select pg_temp.check(credits - debits = 1100, 'sales after reversal and correction')
from account_period_balances where account_code = '4100';

-- Month close
select pg_temp.expect_error(format('select close_period(%L, %L)', :sup, '2026-11'), 'Only an Owner');
select pg_temp.expect_error(format('select close_period(%L, %L)', :nina, '2026-11'), 'Close earlier periods first');
select close_period(:nina, '2026-10');
select pg_temp.expect_error(format('select close_period(%L, %L)', :nina, '2026-11'), 'Draft or Submitted');
select cancel_entry(:sup, (:'e3'::bigint[])[1]);
select close_period(:nina, '2026-11');
select pg_temp.expect_error($$select create_entries('00000000-0000-0000-0000-00000000000c',
  '[{"kind":"Template","transaction_type":1,"book":"Store","entry_date":"2026-11-30","lines":[
   {"account_code":"1110","debit":5},{"account_code":"4100","credit":5,"profit_center":"GGC"}]}]')$$, 'is closed');
select pg_temp.expect_error(format('select reverse_entry(%L, %s, %L)', :sup, (:'e2'::bigint[])[1], 'late fix'), 'is closed');
select reverse_entry(:sup, (:'e2'::bigint[])[1], 'late fix', '[]', '2026-12-01') as r2 \gset
select pg_temp.check(period_key = '2026-12', 'correction to a closed month goes in the open month')
from entries where id = (:'r2'::bigint[])[1];
select pg_temp.expect_error(format('select reopen_period(%L, %L, %L)', :nina, '2026-11', ''), 'needs a reason');
select reopen_period(:kai, '2026-11', 'Late supplier invoice');
select pg_temp.check(status = 'Open', 'owner reopens with a reason') from periods where key = '2026-11';

-- Browsers cannot reach the ledger
set role anon;
select pg_temp.expect_error('select * from public.entries', 'permission denied');
select pg_temp.expect_error($$select public.create_entries('00000000-0000-0000-0000-00000000000c', '[]')$$, 'permission denied');
reset role;
set role authenticated;
select pg_temp.expect_error('select * from public.account_period_balances', 'permission denied');
reset role;

select 'ALL LEDGER TESTS PASSED' as result;
