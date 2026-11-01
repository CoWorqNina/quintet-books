import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { CASH_ON_HAND } from "../../shared/accounts";
import { toDbEntry } from "../../shared/entries";
import { monthEnd } from "../../shared/ledger";
import { toCents } from "../../shared/money";
import { type CountLine, countValue, type GeneratedKind, INVENTORY, inventoryAdjustment } from "../../shared/monthEnd";
import type { AppUser, Book, ProfitCenter } from "../../shared/types";
import { isOwner, seesEverything, todayManila } from "../access";
import { getAccounts } from "../airtable";
import { runChecks } from "../checks";
import { badRequest, dbError, forbidden } from "../db";
import type { AppContext } from "../env";
import { balanceOf, existingGenerated, proposals, totalsAt } from "../monthEnd";
import { serviceClient } from "../supabase";
import { cleanAttachments } from "./attachments";

// Month-end: generated adjusting entries, inventory counts, reconciliations, checks and close.
export const monthEndRoutes = new Hono<AppContext>();

function periodParam(p: string): string {
  if (!/^\d{4}-\d{2}$/.test(p)) badRequest("Choose a month.");
  return p;
}
function booksOnly(user: AppUser) {
  if (!seesEverything(user)) forbidden("Only an Owner or the Accountant does the month-end.");
}
function ended(period: string) {
  if (monthEnd(period) > todayManila()) badRequest(`Month-end entries for ${period} can be made from ${monthEnd(period)}.`);
}
const accountMap = async (env: AppContext["Bindings"]) => new Map((await getAccounts(env)).map((a) => [a.code, a]));

monthEndRoutes.get("/:period/adjustments", async (c) => {
  booksOnly(c.get("user"));
  const period = periodParam(c.req.param("period"));
  const db = serviceClient(c.env);
  const [proposed, existing] = await Promise.all([proposals(db, period, c.env), existingGenerated(db, period)]);
  const kinds: GeneratedKind[] = ["depreciation", "amortization", "interest", "thirteenth", "allowance"];
  const rows = kinds.flatMap((kind) =>
    (["Store", "Commissary"] as Book[]).map((book) => ({
      kind,
      book,
      // The one waiting for approval, if any, else the latest approved one.
      existing:
        existing.find((e) => e.generated === kind && e.book === book && e.status !== "Approved") ??
        existing.filter((e) => e.generated === kind && e.book === book).sort((a, b) => b.id - a.id)[0] ??
        null,
      proposal: proposed.find((p) => p.kind === kind && p.book === book) ?? null,
    })),
  );
  return c.json({ period, endsOn: monthEnd(period), rows: rows.filter((r) => r.existing || r.proposal) });
});

monthEndRoutes.post("/:period/adjustments", async (c) => {
  const user = c.get("user");
  booksOnly(user);
  const period = periodParam(c.req.param("period"));
  ended(period);
  const { kind, book } = await c.req.json<{ kind: GeneratedKind; book: Book }>();
  const db = serviceClient(c.env);
  // A new one can follow an approved one (e.g. food charged after the first run); never two waiting at once.
  const waiting = (await existingGenerated(db, period)).find((e) => e.generated === kind && e.book === book && e.status !== "Approved");
  if (waiting) badRequest(`Entry #${waiting.id} is waiting for approval. Approve or cancel it first.`);
  const proposal = (await proposals(db, period, c.env)).find((p) => p.kind === kind && p.book === book);
  if (!proposal) badRequest("Nothing to generate.");
  const p_entries = [{ ...toDbEntry(proposal.entry), form: { generated: kind, period } }];
  if (proposal.register) {
    // Interest accrual: the entry and the loan rows it books are saved together.
    const { data, error } = await db.rpc("create_entries_with_register", { p_user: user.id, p_entries, p_register: proposal.register });
    dbError(error);
    return c.json({ entryIds: data.entry_ids });
  }
  const { data, error } = await db.rpc("create_entries", { p_user: user.id, p_entries, p_submit: true });
  dbError(error);
  return c.json({ entryIds: data });
});

// Inventory counts --------------------------------------------------------------------------

interface CountRow {
  id: number;
  book: Book;
  profit_center: ProfitCenter;
  period_key: string;
  lines: CountLine[];
  notes: string | null;
  entry_id: number | null;
  updated_at: string;
}

const LOCATIONS: { book: Book; pc: ProfitCenter }[] = [
  { book: "Store", pc: "GGC" },
  { book: "Store", pc: "The Nest" },
  { book: "Commissary", pc: "GGC" },
];

function canCount(user: AppUser, book: Book, pc: ProfitCenter) {
  if (seesEverything(user)) return true;
  if (user.role === "Supervisor") return book === "Store" && user.profitCenters.includes(pc) && user.books.includes("Store");
  if (user.role === "Commissary In-charge") return book === "Commissary";
  return false;
}

monthEndRoutes.get("/:period/inventory", async (c) => {
  const user = c.get("user");
  const period = periodParam(c.req.param("period"));
  const db = serviceClient(c.env);
  const [{ data, error }, totals] = await Promise.all([
    db.from("inventory_counts").select("*").lte("period_key", period).order("period_key", { ascending: false }),
    seesEverything(user) ? totalsAt(db, period) : Promise.resolve([]),
  ]);
  dbError(error);
  const rows = (data ?? []) as CountRow[];
  const live = await liveEntries(db, rows.map((r) => r.entry_id).filter((x): x is number => !!x));
  return c.json({
    period,
    locations: LOCATIONS.filter((l) => canCount(user, l.book, l.pc)).map((l) => {
      const mine = rows.filter((r) => r.book === l.book && r.profit_center === l.pc);
      const count = mine.find((r) => r.period_key === period) ?? null;
      const previous = mine.find((r) => r.period_key < period) ?? null;
      return {
        ...l,
        count: count && { ...count, entry_id: count.entry_id && live.has(count.entry_id) ? count.entry_id : null },
        previous,
        ledgerCents: seesEverything(user) ? inventoryLedger(totals, l.book, l.pc) : null,
      };
    }),
  });
});

/** Inventory balance for a location; untagged lines (the opening balance) belong to GGC. */
function inventoryLedger(totals: Awaited<ReturnType<typeof totalsAt>>, book: Book, pc: ProfitCenter): number {
  return balanceOf(totals, INVENTORY, book, (p) => (p ?? "GGC") === pc);
}

async function liveEntries(db: ReturnType<typeof serviceClient>, ids: number[]): Promise<Set<number>> {
  if (!ids.length) return new Set();
  const [{ data, error }, rev] = await Promise.all([
    db.from("entries").select("id").in("id", ids).not("status", "in", "(Rejected,Cancelled)"),
    db.from("entries").select("reverses_entry_id").in("reverses_entry_id", ids).not("status", "in", "(Rejected,Cancelled)"),
  ]);
  dbError(error);
  dbError(rev.error);
  const reversed = new Set((rev.data ?? []).map((r) => r.reverses_entry_id));
  return new Set((data ?? []).map((r) => r.id as number).filter((id) => !reversed.has(id)));
}

monthEndRoutes.put("/:period/inventory", async (c) => {
  const user = c.get("user");
  const period = periodParam(c.req.param("period"));
  const body = await c.req.json<{ book: Book; profitCenter: ProfitCenter; lines: CountLine[]; notes?: string }>();
  if (!LOCATIONS.some((l) => l.book === body.book && l.pc === body.profitCenter)) badRequest("Choose where the count was taken.");
  if (!canCount(user, body.book, body.profitCenter)) forbidden("You can't enter this count.");
  const lines = (body.lines ?? [])
    .map((l) => ({ item: String(l.item ?? "").trim(), unit: String(l.unit ?? "").trim(), quantity: Number(l.quantity), unit_value: Number(l.unit_value), account: String(l.account ?? "") }))
    .filter((l) => l.item);
  for (const l of lines) {
    if (!(l.quantity >= 0) || !(l.unit_value >= 0)) badRequest(`${l.item}: enter the quantity and unit value.`);
    if (!/^51\d\d$/.test(l.account)) badRequest(`${l.item}: choose its ingredient account.`);
  }
  if (new Set(lines.map((l) => l.item.toLowerCase())).size !== lines.length) badRequest("Each item appears once.");
  const db = serviceClient(c.env);
  const { data: existing, error: e1 } = await db.from("inventory_counts").select("id, entry_id").eq("book", body.book).eq("profit_center", body.profitCenter).eq("period_key", period).maybeSingle();
  dbError(e1);
  if (existing?.entry_id && (await liveEntries(db, [existing.entry_id])).has(existing.entry_id)) {
    badRequest(`The adjustment for this count is entry #${existing.entry_id}. Reverse it before changing the count.`);
  }
  const row = { book: body.book, profit_center: body.profitCenter, period_key: period, lines, notes: body.notes?.trim() || null, counted_by: user.id, entry_id: null };
  const { error } = existing ? await db.from("inventory_counts").update(row).eq("id", existing.id) : await db.from("inventory_counts").insert(row);
  dbError(error);
  return c.json({ ok: true });
});

monthEndRoutes.post("/:period/inventory/generate", async (c) => {
  const user = c.get("user");
  booksOnly(user);
  const period = periodParam(c.req.param("period"));
  ended(period);
  const { book, profitCenter } = await c.req.json<{ book: Book; profitCenter: ProfitCenter }>();
  const db = serviceClient(c.env);
  const [{ data, error }, totals] = await Promise.all([
    db.from("inventory_counts").select("*").eq("book", book).eq("profit_center", profitCenter).lte("period_key", period).order("period_key", { ascending: false }).limit(2),
    totalsAt(db, period),
  ]);
  dbError(error);
  const [count, previous] = (data ?? []) as CountRow[];
  if (!count || count.period_key !== period) badRequest("Enter this month's count first.");
  if (count.entry_id && (await liveEntries(db, [count.entry_id])).has(count.entry_id)) badRequest(`Already generated as entry #${count.entry_id}.`);
  const g = inventoryAdjustment(period, book, profitCenter, count.lines, previous?.lines ?? [], inventoryLedger(totals, book, profitCenter));
  if (!g) badRequest("The count matches the ledger; there's nothing to adjust.");
  const res = await db.rpc("create_entries", { p_user: user.id, p_entries: [{ ...toDbEntry(g.entry), form: { generated: "inventory", period, profitCenter } }], p_submit: true });
  dbError(res.error);
  const entryId = (res.data as number[])[0];
  dbError((await db.from("inventory_counts").update({ entry_id: entryId }).eq("id", count.id)).error);
  return c.json({ entryIds: res.data, total: count.lines.reduce((s, l) => s + countValue(l), 0) });
});

// Reconciliations --------------------------------------------------------------------------

monthEndRoutes.get("/:period/reconciliations", async (c) => {
  booksOnly(c.get("user"));
  const period = periodParam(c.req.param("period"));
  const db = serviceClient(c.env);
  const [accounts, totals, { data, error }] = await Promise.all([
    getAccounts(c.env),
    totalsAt(db, period),
    db.from("reconciliations").select("*").eq("period_key", period),
  ]);
  dbError(error);
  type Rec = { account_code: string; book: Book; statement_balance: number; items: { description: string; amount: number }[]; attachments: unknown[]; updated_at: string };
  const recs = (data ?? []) as Rec[];
  const rows = accounts
    .filter((a) => a.isCashAccount && !a.isHeader)
    .flatMap((a) =>
      (["Store", "Commissary"] as Book[])
        .filter((b) => a.book === "Both" || a.book === b)
        .map((book) => {
          const rec = recs.find((r) => r.account_code === a.code && r.book === book) ?? null;
          const ledgerCents = balanceOf(totals, a.code, book);
          const used = totals.some((t) => t.account_code === a.code && t.book === book);
          const reconciledCents = rec ? toCents(Number(rec.statement_balance)) + rec.items.reduce((s, i) => s + toCents(Number(i.amount)), 0) : null;
          return { code: a.code, name: a.name, book, cashOnHand: CASH_ON_HAND.has(a.code), active: a.active, used, ledgerCents, rec, differenceCents: reconciledCents === null ? null : reconciledCents - ledgerCents };
        }),
    )
    .filter((r) => r.used || r.rec || r.active);
  return c.json({ period, asOf: monthEnd(period), rows });
});

monthEndRoutes.put("/:period/reconciliations", async (c) => {
  const user = c.get("user");
  booksOnly(user);
  const period = periodParam(c.req.param("period"));
  const body = await c.req.json<{ account: string; book: Book; statementBalance: number; items: { description: string; amount: number }[]; attachments?: unknown }>();
  const accounts = await accountMap(c.env);
  const a = accounts.get(body.account);
  if (!a?.isCashAccount) badRequest("Choose a bank, e-wallet or cash account.");
  if (body.book !== "Store" && body.book !== "Commissary") badRequest("Choose a book.");
  if (!Number.isFinite(Number(body.statementBalance))) badRequest("Enter the statement balance.");
  const items = (body.items ?? [])
    .map((i) => ({ description: String(i.description ?? "").trim(), amount: Number(i.amount) }))
    .filter((i) => i.description || i.amount);
  for (const i of items) if (!i.description || !Number.isFinite(i.amount) || !i.amount) badRequest("Each reconciling item needs a description and an amount.");
  const db = serviceClient(c.env);
  const ledgerCents = balanceOf(await totalsAt(db, period), body.account, body.book);
  const { error } = await db.from("reconciliations").upsert(
    {
      account_code: body.account,
      book: body.book,
      period_key: period,
      statement_balance: Number(body.statementBalance),
      items,
      ledger_balance: ledgerCents / 100,
      attachments: cleanAttachments(body.attachments ?? []),
      prepared_by: user.id,
    },
    { onConflict: "account_code,book,period_key" },
  );
  dbError(error);
  return c.json({ ok: true });
});

// Checks, close and reopen -------------------------------------------------------------------

monthEndRoutes.get("/:period/checks", async (c) => {
  booksOnly(c.get("user"));
  const period = periodParam(c.req.param("period"));
  const db = serviceClient(c.env);
  const [checks, periodRow] = await Promise.all([
    runChecks(db, period, await accountMap(c.env), todayManila(), c.env),
    db.from("periods").select("status, closed_at").eq("key", period).maybeSingle(),
  ]);
  dbError(periodRow.error);
  if (!periodRow.data) throw new HTTPException(404, { message: "No such month." });
  return c.json({ period, status: periodRow.data.status, closedAt: periodRow.data.closed_at, checks });
});

monthEndRoutes.post("/:period/close", async (c) => {
  const user = c.get("user");
  if (!isOwner(user)) forbidden("Only an Owner closes a month.");
  const period = periodParam(c.req.param("period"));
  const db = serviceClient(c.env);
  const failing = (await runChecks(db, period, await accountMap(c.env), todayManila(), c.env)).filter((x) => x.status === "fail");
  if (failing.length) return c.json({ error: `Not ready to close: ${failing.map((f) => f.label).join("; ")}.`, failing }, 400);
  dbError((await db.rpc("close_period", { p_user: user.id, p_key: period })).error);
  return c.json({ ok: true });
});

monthEndRoutes.post("/:period/reopen", async (c) => {
  const user = c.get("user");
  if (!isOwner(user)) forbidden("Only an Owner reopens a month.");
  const period = periodParam(c.req.param("period"));
  const { reason } = await c.req.json<{ reason?: string }>();
  if (!reason?.trim()) badRequest("Give the reason for reopening.");
  dbError((await serviceClient(c.env).rpc("reopen_period", { p_user: user.id, p_key: period, p_reason: reason.trim() })).error);
  return c.json({ ok: true });
});
