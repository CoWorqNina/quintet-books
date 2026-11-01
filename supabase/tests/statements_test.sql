-- Behaviour tests for 0006_statements.sql. Runs after month_end_test.sql.

\set kai '\'00000000-0000-0000-0000-00000000000b\''
\set nina '\'00000000-0000-0000-0000-00000000000a\''

select create_entries(:nina, '[
  {"kind":"Template","transaction_type":20,"book":"Commissary","profit_center":"GGC","entry_date":"2027-03-05",
   "lines":[{"account_code":"1280","debit":500},{"account_code":"4190","credit":500,"profit_center":"GGC","template_line":"20.billing"}]},
  {"kind":"Template","transaction_type":20,"book":"Store","profit_center":"GGC","entry_date":"2027-03-05",
   "lines":[{"account_code":"5120","debit":500,"profit_center":"GGC","template_line":"20.cogs"},{"account_code":"2180","credit":500}]},
  {"kind":"Template","transaction_type":1,"book":"Store","profit_center":"GGC","entry_date":"2027-03-06",
   "lines":[{"account_code":"1110","debit":900},{"account_code":"4100","credit":900,"profit_center":"GGC"}]}
]', true) as ids \gset
select approve_entries(:kai, :'ids'::bigint[]);

select pg_temp.check((select bool_and(intercompany) from statement_totals('2027-03-01', '2027-03-31') where account_code in ('4190', '5120')), 'transfer billings are marked intercompany');
select pg_temp.check((select credit from statement_totals('2027-03-01', '2027-03-31') where account_code = '4100') = 900, 'sales by month');
select pg_temp.check((select count(*) from cash_entry_lines('2027-03-01', '2027-03-31', array['1110'])) = 2, 'cash entries with all their lines');

select 'ALL STATEMENT TESTS PASSED' as result;
