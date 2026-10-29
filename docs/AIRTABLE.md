# Airtable base: GGC Books

- Workspace: CLD Ventures (`wspPwAfEl1m02vydN`)
- Base: GGC Books (`appAWl68GqjTKpOSb`)

The app's server code reads and writes this base with a personal access token stored as a
Cloudflare Worker secret. The browser never sees the token.

A new base is created for each fiscal year (see `docs/DECISIONS.md`). Journal data
(Entries, Entry Lines, Account Period Balances, Audit Log) moves to Supabase Postgres; the
tables of those names below were created before that decision and will be removed.

## Tables (Phase 0)

| Table | ID | Notes |
|---|---|---|
| Books | `tbls3bF4VCbbMaiZp` | Store, Commissary |
| Profit Centers | `tblkmJz78OWoT0Bbm` | GGC, The Nest, Shared |
| Accounts | `tblmBkqperzEAxWwa` | 185 rows seeded from `docs/source/chart-of-accounts.xlsx` (31 headers) |
| Periods | `tbl4eSx8Uk9cmuAkm` | 2026-10 (opening balances) to 2027-12 |
| Parties | `tblg89x5iUorCvTpN` | Suppliers, employees, owners, lenders, platforms |
| Users | `tblNyxd2VqVyhSuyd` | Role and access per Supabase user ID |
| Transaction Types | `tblTYOQYyyPLQw2dN` | Section 7 list (seeded in Phase 1) |
| Template Lines | `tblNu20xBBJdbM6c7` | Allowed accounts per template line |
| Entries | `tblwjpQQK7t5fgdx1` | Journal entry headers |
| Entry Lines | `tblbX9YKNrMbvBmGv` | One record per debit or credit |
| Account Period Balances | `tbl9E8HLuVWouxtO0` | Stored balances per account/book/profit center/month |
| Audit Log | `tbl2Ug43GEhWaew17` | Every create/edit/approve/reverse/close/reopen |
| Judgment Log | `tbldoKvRYg9uEsu4d` | Adjustments & Judgment Log |

Later phases add: Daily Reports, For Classification Queue, Commissary Products, Loans and
Loan Schedule, Fixed Assets and Depreciation Schedule, Spread Schedules, Inventory Counts,
Bank Reconciliations, Refunds & Voids.

## Design notes

- Entry Lines copy book, date, period and status from their entry so ledgers can filter
  without lookups. The server keeps them in sync on every status change.
- Account Period Balances hold Approved activity only; `Closing` = Opening + Debits − Credits
  (debit-positive). Statements read these instead of every line.
- Header accounts (`Is Header`) can never be posted to.
- Chart of Accounts parent/statement line is derived by `scripts/coa_to_json.py`.
  6550 Platform & Card Fees is placed directly under Operating Expenses even though its
  code falls inside Marketing's 6500–6599 range.
