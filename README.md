# GGC Books

Internal accounting app for Go Go Chicken and The Nest (Quintet Allied Services & Ventures Corp.).

- Spec: `docs/master-prompt.pdf`
- Build plan: `docs/PHASES.md`
- Decisions since the spec: `docs/DECISIONS.md`
- Airtable base: `docs/AIRTABLE.md`

Stack: Cloudflare Pages + Workers, Supabase (Auth + ledger database), Airtable (setup data).

## Layout

- `worker/` server (Cloudflare Worker, Hono): checks the login and role, talks to Supabase and Airtable
- `src/` screens (React)
- `shared/` types used by both
- `supabase/migrations/` ledger database; `supabase/tests/` its behaviour tests
- `docs/SETUP.md` one-time setup and deployment steps

## Commands

- `npm run dev` local app (needs a `.dev.vars` file with `SUPABASE_SECRET_KEY` and `AIRTABLE_TOKEN`)
- `npm test` unit tests; `npm run test:db` ledger tests against a local Postgres
- `npm run build` production build (Cloudflare runs this on every push to `main`)
