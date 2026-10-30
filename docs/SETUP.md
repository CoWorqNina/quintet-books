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

## Moving to a custom domain later

Add the domain in the Worker → **Settings → Domains & Routes**, then update the Supabase
Site URL. No code changes.
