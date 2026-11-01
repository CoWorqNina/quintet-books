# Year-end and new-year checklist

The fiscal year is January–December. The ledger (Supabase) runs across years; Airtable gets a
new base each year for setup data.

## Before closing December

1. Approve every entry dated in the year (the year can't close while any are waiting).
2. Month-end → Adjusting entries for December: generate and approve depreciation,
   amortization, interest and the 13th month accrual. Do the inventory count if you count.
3. Month-end → Reconciliations for December.

## Close the year (an Owner, from December 31)

4. Month-end → choose December → **Year-end** tab → **Generate closing entry** for the Store
   book and for the Commissary book. Each moves every income and expense balance (per
   profit center) to 3300 Retained Earnings.
5. The other Owner approves both closing entries.
6. Ledger → Trial balance → December → **Post-closing**: only balance sheet accounts remain.
7. Month-end → Close checklist for December → **Close December**.

If a December entry is approved after the closing entry, the Year-end tab shows what is still
open; generate again to close the rest.

## Start the new year in Airtable

8. Airtable → open the current base → **⋯ → Duplicate base** (include records), in the CLD
   Ventures workspace. Name it e.g. "GGC Books 2027".
9. In the new base, empty the **Judgment Log** table (last year's log stays in the old base).
10. Copy the new base ID (the `app…` part of its URL).
11. Cloudflare → Workers & Pages → ggc-books → Settings → Variables and Secrets → set
    **AIRTABLE_BASE_ID** to the new ID → Deploy. The Airtable token keeps working if it has
    access to the new base (Airtable → Developer hub → your token → add the base).
12. Update `docs/AIRTABLE.md` and `AIRTABLE_BASE_ID` in `wrangler.jsonc` so the next deploy
    from GitHub keeps the new base.

Accounting months exist through December 2030. Before then, ask for the next years to be added.

## Every month

- Download a ledger backup from Home now and then and keep it with your files; the app also
  saves one every night to the private "backups" storage bucket.
- Review **Users**: remove access for anyone who has left.
