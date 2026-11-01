# GGC Books — Build Phases

Source of truth: `docs/master-prompt.pdf` (Final version, Oct 29, 2026).
Each phase ends with something usable and tested before the next one starts.

## Phase 0 — Foundation (done, live at https://ggc-books.nina-99a.workers.dev)
- GitHub repo, Cloudflare Worker (API + screens) on a free workers.dev subdomain
- Supabase Auth with role + profit-center access stored per user
- Supabase Postgres ledger schema (entries, lines, period balances, audit log) with
  database-enforced balancing (`supabase/migrations/0001_ledger.sql`, tests in `supabase/tests/`)
- Airtable base for setup data (done: Books, Profit Centers, Chart of Accounts);
  base ID configured per fiscal year; token stored only as a Worker secret
- Server-side rate limiting/queueing for Airtable's 5 req/s per base

## Phase 1 — Daily entry and approvals (built; run `supabase/migrations/0002_daily_reports.sql`)
- Daily cashier report: POS sales summary + handwritten cash report → #1, #2, #3, #4, #6, and
  one #11 / #26 / #39 per paid-out, #10 for cash put into the drawer; live preview and checks
- Standalone forms: #5 pop-up sales, #7 card payout, #8 Grab/Foodpanda payout, #9 deposit,
  #10 transfer, #11 petty cash expense
- Templates are code (`shared/templates.ts`, `shared/dailyReport.ts`), rebuilt and checked on
  the server; reference copy in Airtable Transaction Types
- Approval queue: routine entries in a daily batch, no-receipt entries one by one; reject with reason
- Journal with lines, status, creator/approver and attachments, filtered by role
- Receipts and photos in a private Supabase Storage bucket (shrunk in the browser)
- Nightly ledger backup (2 AM Manila) to the private "backups" bucket; owners can download anytime
- Not yet: editing a submitted entry in place (cancel and re-enter instead), reversals UI,
  For Classification queue (Phase 2)

## Phase 2 — Remaining templates and setup screens (done, live)
- Templates #12–#40 and #43 (Opening Balances): purchases and AP, small items, Commissary
  billing and settlement (#19–#21, both books), payroll (#22–#25), employees (#26–#28),
  assets (#29), prepaids (#31), deposits (#32), loans (#33–#34), owner money (#35–#38)
- Registers in Supabase, created in the same transaction as their entry: Fixed Asset Register,
  prepaid/deferred spreads, Loan Tracker with installment schedule (solved from the lender's
  installment or an agreed rate); go-live records entered on the Registers screen
- Reverse any approved entry; correct template entries in place (reverse + re-enter from the
  saved form, approved together). Reversal is dated like the original unless that month is Final
- For Classification queue: Owner classifies #39 movements out of 1195 Suspense (Judgment Log)
- Special / Adjusting entries line by line (Owner/Accountant, reason, approved one by one)
- Setup screens: suppliers (with owner approval), employees, owners, lenders; accounts
  (Owner adds under a header or deactivates when the balance is zero, Judgment Log)

## Phase 3 — Accounting cycle views (done, live)
- Journal, General Ledger, T-accounts, Trial Balance (unadjusted/adjusted/post-closing; per book and combined)
- Sub-ledgers: AP aging, employee receivables, owner loans/advances, reimbursements, clearing account aging
- Supplier cost comparison for the eight COGS ingredients
- Trial balance: balance sheet accounts carried from the start, income and expenses year to date;
  earlier years not yet closed are shown inside Retained Earnings until the year-end closing (Phase 6)
- AP and clearing aging match payments to the oldest open amounts first (first in, first out)

## Phase 4 — Schedules and month-end (done, live)
- Generated adjusting entries for owner approval (one by one): depreciation per asset (straight
  line, full first month), amortization of prepaids and deferred charges, loan interest accrual,
  13th month accrual (1/12 of the month's gross pay). Each is "due to date minus already booked",
  so a missed month catches up and nothing is booked twice
- Inventory counts per location (Store–GGC, Store–The Nest, Commissary), optional; adjustment per
  item against the last count, plus any gap with the ledger
- Bank, e-wallet and cash-on-hand reconciliations with reconciling items and statement attachments
- Close checklist + Section 10 checks on one page; an Owner closes only when nothing fails;
  reopening needs a reason (logged)
- Not yet: the "Cash" check (cash flow closing = balance sheet cash) arrives with the Cash Flow
  Statement in Phase 5

## Phase 5 — Statements and reports (done, live)
- Income Statement: monthly and year to date (GGC | The Nest | Shared | Total), month by month
  with YTD and % of sales, and this month vs last month vs YTD; views for the whole business,
  GGC as a whole, The Nest, Store book and Commissary book
- Balance Sheet (this month-end vs last), current / non-current, loans split by due within
  12 months, accrued interest on its own line; whole business, Store and Commissary views
- Cash Flow Statement (direct method), monthly and YTD, and one per cash account; the month-end
  "Cash" check now runs
- Exports: CSV per statement and print / save as PDF. Supplier cost comparison is under Ledger
- Not yet: a one-page monthly management report (Phase 6)

## Phase 6 — Year-end and hardening (done)
- Monthly management report (Section 9): summary led by cash, payroll cover and loan payments
  due; GGC (Store, Commissary, eliminations) and The Nest income statements; balance sheet and
  cash flow; COGS per ingredient monthly and rolling 3 months; loan summary; key ratios
  (COGS, labor, utilities, marketing, net margin, debt service, cash runway); Judgment Log;
  red flags; open items. Printable
- Year-end close: one Closing entry per book to Retained Earnings, approved by the other Owner;
  post-closing trial balance; December checklist item. Steps in `docs/YEAR_END.md`
- Users screen (Owners): invite by email, change role, books and profit centers, remove access;
  at least one active Owner always remains; changes in the audit log
- New-year Airtable base, custom domain and backups: documented in `docs/YEAR_END.md` and
  `docs/SETUP.md`
