# Decisions log

Build decisions made by management after the master prompt (Final version, Oct 29, 2026).
Accounting decisions are also recorded in the Airtable Judgment Log.

| Date | Decision | Decided by |
|---|---|---|
| 2026-11-01 | Owner's food allowance: owners may take food at menu price up to ₱3,000 per owner per month as compensation (6135 Owner's Allowance – Food, tagged per owner and profit center). Food above it is moved at month-end to 1255 Receivable from Owners – Food Charges and paid back with #38. Staff food stays a receivable deducted from pay. The daily report's food-charge section lists staff and owners. The limit is set in `shared/config.ts`. | Nina |
| 2026-11-01 | Removed 7170 Bank Fees (duplicate); use 6740 Bank Charges. | Nina |
| 2026-11-01 | Year-end closes straight to 3300 Retained Earnings, per book and profit center; 3400 Current Year Earnings stays unused. | Build |
| 2026-11-01 | Management report "next payroll" = half of the month's net pay (two pay periods); cash runway = cash ÷ average weekly operating spending over the last 3 months. | Build |
| 2026-11-01 | Statement formats approved: Income Statement monthly, YTD, month by month, and this month vs YTD; Balance Sheet vs prior month-end. | Nina |
| 2026-11-01 | Whole-business and GGC-as-a-whole views remove every Commissary transfer billing (#20) and the matching Store cost, including billings to The Nest. Store and Commissary book views keep them. | Build |
| 2026-11-01 | Cash flow (direct): each entry's cash is spread over the other side of the entry in proportion (an installment splits into principal and interest; an asset bought partly on credit counts only the cash paid). Cash in transit (1190) and Suspense (1195) count as cash until cleared, so a classified cash-out shows under what it turned out to be. | Build |
| 2026-11-01 | Loan principal and interest payable are kept apart: principal in each loan's own Loans Payable account, interest owed in 2250 Accrued Interest Payable with every line tagged to its loan (also required on opening balances and special entries). Shown per loan under Ledger → Sub-ledgers → Loans & interest payable. | Nina |
| 2026-11-01 | Loan interest (accrued and paid) is tagged GGC; loans are taken for the business as a whole. Change per loan later if needed. | Build |
| 2026-11-01 | 13th month accrual = 1/12 of the gross pay recorded by #22 in the month, per profit center. | Build |
| 2026-11-01 | Inventory is counted per location (Store–GGC, Store–The Nest, Commissary); the opening inventory balance belongs to GGC until the first count. | Build |
| 2026-11-01 | Missing daily reports are flagged for review, not blocking (the store may have been closed). Pending entries, clearing balances past 10/14 days, unreconciled cash accounts, suspense and unbalanced books block the close. | Build |
| 2026-10-30 | Fixed assets, prepaid/deferred spreads and loans live in **Supabase** (not Airtable) so each record is saved in the same transaction as its entry and drops out automatically when that entry is reversed or cancelled. | Build |
| 2026-10-30 | Loan installments are split from a schedule: lender loans solve the rate from the fixed installment; informal loans use the agreed rate (0% if none). One Loans Payable account per loan. | Build |
| 2026-10-30 | Approved entries are never edited. Corrections reverse the original and re-enter it (approved together). Asset, prepaid and loan entries are reversed and entered again rather than corrected in place. | Build |
| 2026-10-30 | Only Owners classify For Classification movements and enter opening balances; the other Owner approves. | Build |
| 2026-10-29 | Logins use **Supabase Auth** (master prompt allowed Clerk or Supabase). | Nina |
| 2026-10-29 | Airtable base lives in the **CLD Ventures** workspace. | Nina |
| 2026-10-29 | Chart of Accounts source is the Oct 29 workbook (`docs/source/chart-of-accounts.xlsx`), which supersedes the Section 5 list where they differ (e.g. GoTyme 1170 reactivated, per-loan interest accounts 7510–7530). | Nina |
| 2026-10-29 | 1220 Due from CLD, 1230 Due from Other Related Parties and 2170 Due to CLD are kept, with cash flow group **Financing** (related-party loans). | Nina |
| 2026-10-29 | Quantity, unit and unit price are required on purchases of **every COGS account** (5100–5195 and The Nest's 5210–5280), not only the eight core ingredients. 5199 Inventory Adjustment is excluded (it is never purchased). | Nina |
| 2026-10-29 | **Journal data lives in Supabase Postgres**, not Airtable, to stay clear of Airtable's per-base record limit. Airtable gets a **new base each fiscal year** for setup data and trackers. | Nina |
| 2026-10-29 | Section 13 has no open items; templates #41 and #42 are intentionally absent. | Nina |
| 2026-10-30 | Users/roles and Periods live in Supabase with the ledger: approval and month-lock rules are checked inside the database in the same transaction as posting. | Build |
| 2026-10-31 | All POS discounts go on the Daily Cash Sales entry as one line (encoder picks SC/PWD or Promo); card, GCash and platform sales are recorded at the POS net figure. | Nina |
| 2026-10-31 | Refunds: each channel uses the POS net figure; refunds stay off the ledger. | Nina |
| 2026-10-31 | Paid-outs from the drawer are tagged by the encoder: expense (#11), employee cash advance (#26) or unclassified (#39, Suspense until classified). One entry per paid-out so each keeps its own receipt. | Nina / Build |
| 2026-10-31 | Food charges are split per employee on the daily report; the split must equal the POS food charges. | Nina |
| 2026-10-31 | The Nest uses the same daily report from its own POS, posting to its own cash, GCash and clearing accounts (1156, 1157, 1158, 1184-1186). 1158 E-Wallet – GCash – The Nest was added. | Nina / Build |
| 2026-10-31 | Banks are a free choice: deposits (#9), card and platform payouts (#7, #8) and transfers (#10) can go to any active bank or e-wallet, since there is one consolidated Balance Sheet (e.g. The Nest usually deposits to GoTyme 1170). | Nina |
| 2026-10-31 | Employees are kept in the Airtable Parties table (Type = Employee) so management can edit them anytime. | Nina |
| 2026-10-31 | Petty cash on #1 moves by the difference needed to end at the counted next-day amount (e.g. Oct 29: ₱3,615 − ₱2,289 + ₱3,869 = ₱5,195). | Build |
| 2026-10-31 | Payouts and transfers (#7, #8, #10) are entered by Owner/Accountant only. Cash deposits (#9) can also be entered by Supervisors. | Nina / Build |
| 2026-10-31 | Entries can't be dated before go-live (Nov 1, 2026) or in the future. | Build |
| 2026-10-29 | 6550 Platform & Card Fees rolls up directly under Operating Expenses, not under Marketing (its code sits inside 6500–6599). | Build |

## Where the data lives

| Store | Holds | Why |
|---|---|---|
| Supabase Postgres | Users and roles, Periods (month locks), Entries, Entry Lines, Account Period Balances, Audit Log | Posting an entry (header, lines, balances, audit row) must succeed or fail as one transaction, and the database can enforce "debits equal credits" itself. Free tier comfortably holds years of lines. |
| Supabase Postgres (registers) | Fixed assets, prepaid/deferred spreads, loans and installments | Saved with their entry in one transaction. |
| Airtable (one base per fiscal year) | Chart of Accounts, Parties, Commissary Products, Transaction Types and Template Lines, inventory counts, bank reconciliations, Judgment Log | Easy for Nina and Kai to view and edit; low record counts. |
| Supabase Auth | Logins | One login per person; role and access in `app_users`. |

Header and line records for the same entry are never split across the two stores.

## Supabase free tier: things to watch

- Free projects are paused after about a week with no activity. Daily use prevents this.
- The free tier does not include downloadable automated backups. The app will run its own
  nightly export of the ledger (Phase 1 task).
- Check current limits on Supabase's pricing page before go-live; they change.
