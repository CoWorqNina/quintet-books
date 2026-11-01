# Setup guide

One-time steps to get GGC Books running. Do them in order.

## 1. Supabase: create the ledger

1. Open the project at supabase.com/dashboard → **SQL Editor** → **New query**.
2. Paste the whole of `supabase/migrations/0001_ledger.sql` and click **Run**.
   It should finish with "Success. No rows returned".
3. **Turn off public sign-ups** so only people you add can log in:
   **Authentication → Sign In / Providers → Email** (or **Auth settings**) → turn off
   **Allow new users to sign up**. Keep the Email provider itself enabled.

## 2. Supabase: add people

For each person (start with Nina and Kai):

1. **Authentication → Users → Add user → Create new user**. Enter their email and a
   temporary password and tick **Auto Confirm User**.
2. In **SQL Editor**, give them a role (edit the email, name, role and access):

```sql
insert into app_users (id, email, full_name, role, books, profit_centers)
select id, email, 'Nina Laluna', 'Owner', '{Store,Commissary}', '{GGC,"The Nest"}'
from auth.users where email = 'nina@example.com';
```

Roles: `Owner`, `Accountant`, `Supervisor`, `Staff`, `Commissary In-charge`.
Books: `Store`, `Commissary`. Profit centers: `GGC`, `The Nest`.
For example, a Nest supervisor is `'Supervisor', '{Store}', '{"The Nest"}'`.

They can change their password with **Forgot password** on the sign-in screen.
(An in-app screen for owners to add people comes in a later phase.)

## 3. Airtable: create a token for the app

1. Go to airtable.com/create/tokens → **Create new token**, named `GGC Books app`.
2. Scopes: `data.records:read`, `data.records:write`, `schema.bases:read`.
3. Access: only the **GGC Books** base.
4. Copy the token (starts with `pat`). You'll paste it into Cloudflare in step 4. Don't share it here.

## 4. Cloudflare: deploy from GitHub

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository**.
2. Connect GitHub and pick `CoWorqNina/quintet-books`.
3. Settings:
   - Project name: `ggc-books`
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
4. Deploy. When it finishes you get a URL like `https://ggc-books.<your-subdomain>.workers.dev`.
5. In the Worker → **Settings → Variables and Secrets**, add two **Secrets**:
   - `SUPABASE_SECRET_KEY`: Supabase → Project Settings → API Keys → **Secret keys** (`sb_secret_…`)
   - `AIRTABLE_TOKEN`: the token from step 3
6. Every push to `main` now redeploys automatically.

## 5. Supabase: tell it the app's address

**Authentication → URL Configuration** → set **Site URL** to the Cloudflare URL from step 4,
so password-reset emails link back to the app.

## 6. Phase 1 additions

1. Supabase → **SQL Editor** → paste all of `supabase/migrations/0002_daily_reports.sql` → **Run**.
   It adds daily reports and creates two private storage buckets (`attachments`, `backups`).
   Check under **Storage** that both buckets exist.
2. Airtable → **Parties**: add each employee with **Type = Employee**, their **Books**
   (Store/Commissary), **Profit Center** (GGC or The Nest) and tick **Active**. Untick Active
   when someone leaves; they disappear from the app within a minute.

## 7. Phase 2 additions

1. Supabase → **SQL Editor** → paste all of `supabase/migrations/0003_registers.sql` → **Run**.
   It adds the registers (fixed assets, prepaid/deferred spreads, loans). Run it **before**
   the Phase 2 code is deployed.
2. Airtable → **Commissary Products**: one row per product the Commissary bills (name, unit,
   COGS account such as 5130, Active).
3. Airtable → **Parties**: add **Kai** and **Nina** with **Type = Owner**, and each lender
   (e.g. Union Bank) with **Type = Lender**.
4. In the app, after go-live: Home → **Opening balances (#43)** for each book, then
   **Registers → Add go-live record** for each asset, prepaid and loan that exists on Oct 31.

## 8. Phase 3 additions

1. Supabase → **SQL Editor** → paste all of `supabase/migrations/0004_ledger_views.sql` → **Run**.
   It adds read-only report functions (trial balance, general ledger, sub-ledgers). Run it
   **before** the Phase 3 code is deployed.

## 9. Phase 4 additions

1. Supabase → **SQL Editor** → paste all of `supabase/migrations/0005_month_end.sql` → **Run**.
   It adds inventory counts, reconciliations and month-end helper functions. Run it **before**
   the Phase 4 code is deployed.

## 10. Phase 5 additions

1. Supabase → **SQL Editor** → paste all of `supabase/migrations/0006_statements.sql` → **Run**.
   It adds read-only statement functions. Run it **before** the Phase 5 code is deployed.

## 11. Straight-line loans

1. Supabase → **SQL Editor** → run `supabase/migrations/0007_loans_straight_line.sql`.
2. Then run `supabase/data/golive_loans.sql` (UB and RCBC go-live records).

## Moving to a custom domain later

Add the domain in the Worker → **Settings → Domains & Routes**, then update the Supabase
Site URL. No code changes.
