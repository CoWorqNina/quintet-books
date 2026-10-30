# Airtable base: GGC Books

- Workspace: CLD Ventures (`wspPwAfEl1m02vydN`)
- Base: GGC Books (`appAWl68GqjTKpOSb`)

The app's server code reads and writes this base with a personal access token stored as a
Cloudflare Worker secret. The browser never sees the token.

A new base is created for each fiscal year (see `docs/DECISIONS.md`). Journal data
(Entries, Entry Lines, Account Period Balances, Audit Log) lives in Supabase Postgres; those
Airtable tables were deleted on Oct 29, 2026.

## Tables (Phase 0)

| Table | ID | Notes |
|---|---|---|
| Books | `tbls3bF4VCbbMaiZp` | Store, Commissary |
| Profit Centers | `tblkmJz78OWoT0Bbm` | GGC, The Nest, Shared |
| Accounts | `tblmBkqperzEAxWwa` | 185 rows seeded from `docs/source/chart-of-accounts.xlsx` (31 headers) |
| Periods | `tbl4eSx8Uk9cmuAkm` | Superseded by Supabase `periods`; to be deleted |
| Parties | `tblg89x5iUorCvTpN` | Suppliers, employees, owners, lenders, platforms |
| Users | `tblNyxd2VqVyhSuyd` | Superseded by Supabase `app_users`; to be deleted |
| Transaction Types | `tblTYOQYyyPLQw2dN` | Section 7 list (seeded in Phase 1) |
| Template Lines | `tblNu20xBBJdbM6c7` | Allowed accounts per template line |
| Judgment Log | `tbldoKvRYg9uEsu4d` | Adjustments & Judgment Log |

Later phases add: Daily Reports, For Classification Queue, Commissary Products, Loans and
Loan Schedule, Fixed Assets and Depreciation Schedule, Spread Schedules, Inventory Counts,
Bank Reconciliations, Refunds & Voids.

## Design notes

- Header accounts (`Is Header`) can never be posted to.
- Chart of Accounts parent/statement line is derived by `scripts/coa_to_json.py`.
  6550 Platform & Card Fees is placed directly under Operating Expenses even though its
  code falls inside Marketing's 6500–6599 range.
