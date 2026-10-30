-- Behaviour tests for 0004_ledger_views.sql. Runs after registers_test.sql on a fresh book (Commissary 2027).

\set kai '\'00000000-0000-0000-0000-00000000000b\''
\set nina '\'00000000-0000-0000-0000-00000000000a\''

select create_entries(:nina, '[
  {"kind":"Template","transaction_type":12,"book":"Commissary","profit_center":"GGC","entry_date":"2027-01-05","description":"Chicken",
   "lines":[{"account_code":"5130","debit":4200,"quantity":20,"unit":"kg","unit_price":210,"profit_center":"GGC"},
            {"account_code":"2100","credit":4200,"party_id":"recSup","party_name":"Davao Poultry"}]},
  {"kind":"Template","transaction_type":13,"book":"Commissary","profit_center":"GGC","entry_date":"2027-01-20","description":"Pay",
   "lines":[{"account_code":"2100","debit":1000,"party_id":"recSup","party_name":"Davao Poultry"},{"account_code":"1140","credit":1000}]},
  {"kind":"Adjusting","book":"Commissary","entry_date":"2027-01-31","reason":"Accrual","description":"Accrue",
   "lines":[{"account_code":"6610","debit":300,"profit_center":"GGC"},{"account_code":"2100","credit":300,"party_id":"recSup","party_name":"Davao Poultry"}]}
]', true) as ids \gset
select approve_entries(:kai, :'ids'::bigint[]);

select pg_temp.check((select sum(year_debit) from account_totals('2027-01-31', '2027-01-01', 'unadjusted') where book = 'Commissary' and account_code = '6610') is null,
  'unadjusted trial balance leaves out the month''s adjusting entries');
select pg_temp.check((select year_debit from account_totals('2027-01-31', '2027-01-01', 'adjusted') where book = 'Commissary' and account_code = '6610') = 300,
  'adjusted trial balance includes them');
select pg_temp.check((select sum(year_debit) - sum(year_credit) + sum(prior_debit) - sum(prior_credit) from account_totals('2027-01-31', '2027-01-01', 'adjusted')) = 0,
  'trial balance totals agree');
select pg_temp.check((select count(*) from gl_lines('2100', 'Commissary', '2027-01-01', '2027-01-31')) = 3, 'general ledger lists the account''s lines');
select pg_temp.check(gl_opening('2100', 'Commissary', '2027-01-20') = -4200, 'opening balance before a date');
select pg_temp.check((select sum(credit) - sum(debit) from party_lines(array['2100'], '2027-01-31') where party_id = 'recSup' and book = 'Commissary') = 3500,
  'party balance for the supplier');
select pg_temp.check((select supplier from cost_lines(array['5130'], '2027-01-01', '2027-01-31')) = 'Davao Poultry', 'cost lines carry the supplier');

select 'ALL VIEW TESTS PASSED' as result;
