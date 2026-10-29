# Decisions log

Build decisions made by management after the master prompt (Final version, Oct 29, 2026).
Accounting decisions are also recorded in the Airtable Judgment Log.

| Date | Decision | Decided by |
|---|---|---|
| 2026-10-29 | Logins use **Supabase Auth** (master prompt allowed Clerk or Supabase). | Nina |
| 2026-10-29 | Airtable base lives in the **CLD Ventures** workspace. | Nina |
| 2026-10-29 | Chart of Accounts source is the Oct 29 workbook (`docs/source/chart-of-accounts.xlsx`), which supersedes the Section 5 list where they differ (e.g. GoTyme 1170 reactivated, per-loan interest accounts 7510–7530). | Nina |
| 2026-10-29 | 1220 Due from CLD, 1230 Due from Other Related Parties and 2170 Due to CLD are kept, with cash flow group **Financing** (related-party loans). | Nina |
| 2026-10-29 | Quantity, unit and unit price are required on purchases of **every COGS account** (5100–5195 and The Nest's 5210–5280), not only the eight core ingredients. 5199 Inventory Adjustment is excluded (it is never purchased). | Nina |
| 2026-10-29 | **Journal data lives in Supabase Postgres**, not Airtable, to stay clear of Airtable's per-base record limit. Airtable gets a **new base each fiscal year** for setup data and trackers. | Nina |
| 2026-10-29 | Section 13 has no open items; templates #41 and #42 are intentionally absent. | Nina |
| 2026-10-29 | 6550 Platform & Card Fees rolls up directly under Operating Expenses, not under Marketing (its code sits inside 6500–6599). | Build |

## Where the data lives

| Store | Holds | Why |
|---|---|---|
| Supabase Postgres | Entries, Entry Lines, Account Period Balances, Audit Log | Posting an entry (header, lines, balances, audit row) must succeed or fail as one transaction, and the database can enforce "debits equal credits" itself. Free tier comfortably holds years of lines. |
| Airtable (one base per fiscal year) | Chart of Accounts, Parties, Transaction Types and Template Lines, Periods, schedules (loans, assets, spreads), inventory counts, bank reconciliations, Judgment Log | Easy for Nina and Kai to view and edit; low record counts. |
| Supabase Auth | Logins | One login per person; role and access stored against the user. |

Header and line records for the same entry are never split across the two stores.

## Supabase free tier: things to watch

- Free projects are paused after about a week with no activity. Daily use prevents this.
- The free tier does not include downloadable automated backups. The app will run its own
  nightly export of the ledger (Phase 0/1 task).
- Check current limits on Supabase's pricing page before go-live; they change.
