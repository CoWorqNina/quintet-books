# GGC Books — Build Phases

Source of truth: `docs/master-prompt.pdf` (Final version, Oct 29, 2026).
Each phase ends with something usable and tested before the next one starts.

## Phase 0 — Foundation (built; see docs/SETUP.md to deploy)
- GitHub repo, Cloudflare Worker (API + screens) on a free workers.dev subdomain
- Supabase Auth with role + profit-center access stored per user
- Supabase Postgres ledger schema (entries, lines, period balances, audit log) with
  database-enforced balancing (`supabase/migrations/0001_ledger.sql`, tests in `supabase/tests/`)
- Airtable base for setup data (done: Books, Profit Centers, Chart of Accounts);
  base ID configured per fiscal year; token stored only as a Worker secret
- Server-side rate limiting/queueing for Airtable's 5 req/s per base

## Phase 1 — Posting engine + daily entry (go-live critical)
- Nightly ledger export (Supabase free tier has no backups)
- Transaction Types + Template Lines tables; entries built only from templates
- Entry lifecycle: Draft → Submitted → Approved / Rejected; no self-approval; batch approval for routine entries
- Server checks: balanced, required fields, attachments, period not closed, role and profit-center rules
- Audit log for every create/edit/approve/reverse/reopen
- Templates #1–#11 (daily sales, payouts, deposits, transfers, petty cash) + Daily Reports screen
- Account Period Balances updated on approval

## Phase 2 — Remaining templates and setup screens
- Templates #12–#40 and #43 (Opening Balances)
- Setup screens: accounts, suppliers (with owner approval), employees, owners, lenders
- Commissary products + COGS mapping; intercompany templates #19–#21 posting to both books
- For Classification queue + Suspense; Supervisor edit/cancel via reversal

## Phase 3 — Accounting cycle views
- Journal, General Ledger, T-accounts, Trial Balance (unadjusted/adjusted/post-closing; per book and combined)
- Sub-ledgers: AP aging, employee receivables, owner loans/advances, reimbursements, clearing account aging

## Phase 4 — Schedules and month-end
- Fixed Asset Register + depreciation, spread schedules, loan tracker + interest accrual
- Payroll and 13th-month accruals, inventory counts and adjustment
- Generated adjusting entries for owner approval
- Bank reconciliations, Checks page (Section 10), close checklist, period lock/reopen

## Phase 5 — Statements and reports
- Income Statement (GGC | The Nest | Shared | Total), Balance Sheet, Cash Flow (direct) and Cash Flow per Account
- Store / Commissary / Combined views with intercompany eliminations
- Monthly management report, supplier cost comparison, exports

## Phase 6 — Year-end and hardening
- Year-end close to Retained Earnings, post-closing trial balance
- Custom domain switch (config only), backups, load/rate-limit testing
