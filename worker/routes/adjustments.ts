import { type Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ACCOUNTS } from "../../shared/accounts";
import { toDbEntry } from "../../shared/entries";
import { buildClassification, buildManualEntry, type ClassifyLine, type ManualInput, OPENING_DATE } from "../../shared/manual";
import { getTemplate, type Values } from "../../shared/templates";
import type { AppUser, Book } from "../../shared/types";
import { checkEntryDate, isOwner, seesEverything, todayManila } from "../access";
import { getAccounts, getParties } from "../airtable";
import { badRequest, dbError, forbidden } from "../db";
import type { AppContext } from "../env";
import { ENTRY_SELECT, getUserNames, isCorrectable, toJournalEntry } from "../journal";
import { logJudgment } from "../judgment";
import { serviceClient } from "../supabase";
import { templateContext } from "../templateContext";
import { cleanAttachments } from "./attachments";
import { cleanValues } from "./entries";

// Corrections and entries outside the templates: reversals, Special/Adjusting entries,
// opening balances and the classification of "For Classification" movements.
export const adjustments = new Hono<AppContext>();

function ownerOrAccountant(user: AppUser, what: string) {
  if (!seesEverything(user)) forbidden(`Only an Owner or the Accountant ${what}.`);
}

async function loadEntry(c: { env: AppContext["Bindings"] }, id: number) {
  const { data, error } = await serviceClient(c.env)
    .from("entries")
    .select("id, kind, transaction_type, book, profit_center, entry_date, period_key, status, description, daily_report_id, form, entry_lines(account_code, debit, credit)")
    .eq("id", id)
    .maybeSingle();
  dbError(error);
  if (!data) throw new HTTPException(404, { message: "Entry not found." });
  return data;
}

async function periodIsFinal(c: { env: AppContext["Bindings"] }, key: string): Promise<boolean> {
  const { data, error } = await serviceClient(c.env).from("periods").select("status").eq("key", key).maybeSingle();
  dbError(error);
  return data?.status === "Final";
}

// One entry with the form it was built from (for the correction screen).
adjustments.get("/:id{[0-9]+}", async (c) => {
  const user = c.get("user");
  ownerOrAccountant(user, "corrects entries");
  const db = serviceClient(c.env);
  const id = Number(c.req.param("id"));
  const [{ data, error }, accounts, names] = await Promise.all([
    db.from("entries").select(`${ENTRY_SELECT}, form`).eq("id", id).maybeSingle(),
    getAccounts(c.env),
    getUserNames(db),
  ]);
  dbError(error);
  if (!data) throw new HTTPException(404, { message: "Entry not found." });
  return c.json({ entry: toJournalEntry(data, new Map(accounts.map((a) => [a.code, a])), names), form: (data as { form: unknown }).form });
});

// Reverse an approved entry (and its two-book partner), optionally re-entering it corrected.
// The reversal is dated like the original unless that month is final, then today.
adjustments.post("/:id{[0-9]+}/reverse", async (c) => {
  const user = c.get("user");
  ownerOrAccountant(user, "reverses entries");
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ reason?: string; values?: Values }>();
  const reason = body.reason?.trim();
  if (!reason) badRequest("Give the reason for the reversal.");
  const original = await loadEntry(c, id);
  if (original.status !== "Approved") badRequest("Only approved entries are reversed; edit or cancel the others.");
  const date = (await periodIsFinal(c, original.period_key)) ? todayManila() : original.entry_date;

  let replacements: unknown[] = [];
  if (body.values) {
    if (!isCorrectable(original)) badRequest("This entry can't be corrected in place; reverse it and enter it again.");
    const form = original.form as { template: number; book: Book; profitCenter: "GGC" | "The Nest" } | null;
    const template = getTemplate(original.transaction_type ?? 0);
    if (!form || !template) badRequest("This entry has no saved form to correct.");
    if (!template.roles.includes(user.role)) forbidden(`Your role can't enter ${template.name}.`);
    const values = cleanValues(template.fields, body.values);
    checkEntryDate(String(values.date ?? ""));
    const ctx = await templateContext(c.env, user, template, form.book, form.profitCenter);
    const built = template.build(values, ctx);
    if (built.errors.length || !built.entries.length) return c.json({ error: built.errors[0] ?? "Nothing to record.", errors: built.errors }, 400);
    const newForm = { ...form, values };
    replacements = built.entries.map((d) => ({ ...toDbEntry(d), reason, form: newForm }));
  }

  const { data, error } = await serviceClient(c.env).rpc("reverse_entry", {
    p_user: user.id,
    p_id: id,
    p_reason: reason,
    p_replacements: replacements,
    p_entry_date: date,
  });
  dbError(error);
  return c.json({ entryIds: data });
});

// Special or Adjusting entry typed line by line; always approved one by one.
adjustments.post("/manual", async (c) => {
  const user = c.get("user");
  ownerOrAccountant(user, "makes special entries");
  const input = await c.req.json<ManualInput>();
  if (input.kind !== "Special" && input.kind !== "Adjusting") badRequest("Choose Special or Adjusting.");
  if (!user.books.includes(input.book)) forbidden(`You don't have access to the ${input.book} book.`);
  checkEntryDate(input.date);
  return saveManual(c, user, { ...input, attachments: cleanAttachments(input.attachments ?? []) });
});

// Opening balances (#43): balance sheet accounts as of Oct 31, 2026, one entry per book, Owner only.
adjustments.post("/opening", async (c) => {
  const user = c.get("user");
  if (!isOwner(user)) forbidden("Only an Owner enters the opening balances.");
  const input = await c.req.json<ManualInput>();
  return saveManual(c, user, {
    ...input,
    kind: "Opening",
    date: OPENING_DATE,
    description: input.description || `Opening balances, ${input.book} book`,
    attachments: cleanAttachments(input.attachments ?? []),
  });
});

async function saveManual(c: Context<AppContext>, user: AppUser, input: ManualInput) {
  if (input.book !== "Store" && input.book !== "Commissary") badRequest("Choose the Store or Commissary book.");
  const [accounts, parties] = await Promise.all([getAccounts(c.env), getParties(c.env)]);
  const { entry, errors } = buildManualEntry(
    input,
    new Map(accounts.map((a) => [a.code, a])),
    new Map(parties.map((p) => [p.id, p])),
  );
  if (!entry) return c.json({ error: errors[0], errors }, 400);
  const { data, error } = await serviceClient(c.env).rpc("create_entries", { p_user: user.id, p_entries: [toDbEntry(entry)], p_submit: true });
  if (error?.message.includes("entries_one_opening_per_book")) {
    badRequest(`The ${input.book} book already has opening balances. Reverse them first to enter new ones.`);
  }
  dbError(error);
  return c.json({ entryIds: data });
}

// "For Classification" queue: approved #39 movements not yet classified (or whose classification was undone).
adjustments.get("/unclassified", async (c) => {
  const user = c.get("user");
  ownerOrAccountant(user, "classifies movements");
  const db = serviceClient(c.env);
  const [{ data, error }, accounts, names] = await Promise.all([
    db.from("entries").select(ENTRY_SELECT).eq("transaction_type", 39).eq("kind", "Template").eq("status", "Approved").order("entry_date").limit(500),
    getAccounts(c.env),
    getUserNames(db),
  ]);
  dbError(error);
  const rows = (data ?? []) as unknown as { id: number }[];
  const ids = rows.map((r) => r.id);
  const settled = new Set<number>();
  if (ids.length) {
    const [classified, reversed] = await Promise.all([
      db.from("entries").select("id, classifies_entry_id, status").in("classifies_entry_id", ids).not("status", "in", "(Rejected,Cancelled)"),
      db.from("entries").select("reverses_entry_id").in("reverses_entry_id", ids).not("status", "in", "(Rejected,Cancelled)"),
    ]);
    dbError(classified.error);
    dbError(reversed.error);
    // A classification that was itself reversed no longer settles the movement.
    const classIds = (classified.data ?? []).map((r) => r.id as number);
    const undone = new Set<number>();
    if (classIds.length) {
      const r = await db.from("entries").select("reverses_entry_id").in("reverses_entry_id", classIds).not("status", "in", "(Rejected,Cancelled)");
      dbError(r.error);
      for (const x of r.data ?? []) undone.add(x.reverses_entry_id as number);
    }
    for (const x of classified.data ?? []) if (!undone.has(x.id as number)) settled.add(x.classifies_entry_id as number);
    for (const x of reversed.data ?? []) settled.add(x.reverses_entry_id as number);
  }
  const accountMap = new Map(accounts.map((a) => [a.code, a]));
  return c.json(rows.filter((r) => !settled.has(r.id)).map((r) => toJournalEntry(r, accountMap, names)));
});

adjustments.post("/:id{[0-9]+}/classify", async (c) => {
  const user = c.get("user");
  if (!isOwner(user)) forbidden("Only an Owner classifies movements.");
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ reason?: string; lines?: ClassifyLine[] }>();
  const original = await loadEntry(c, id);
  if (original.transaction_type !== 39 || original.kind !== "Template") badRequest("Only For Classification entries are classified here.");
  if (original.status !== "Approved") badRequest("The movement must be approved first.");
  const suspense = (original.entry_lines as { account_code: string; debit: number; credit: number }[]).find((l) => l.account_code === ACCOUNTS.suspense);
  if (!suspense) badRequest("This entry has no suspense line.");
  const moneyOut = Number(suspense.debit) > 0;
  const date = (await periodIsFinal(c, original.period_key)) ? todayManila() : original.entry_date;
  const accounts = await getAccounts(c.env);
  const { entry, errors } = buildClassification(
    {
      id,
      book: original.book,
      date: original.entry_date,
      amountCents: Math.round(Number(moneyOut ? suspense.debit : suspense.credit) * 100),
      moneyOut,
      description: original.description ?? "",
    },
    { date, reason: body.reason ?? "", lines: body.lines ?? [] },
    new Map(accounts.map((a) => [a.code, a])),
  );
  if (!entry) return c.json({ error: errors[0], errors }, 400);
  const db = serviceClient(c.env);
  const { data: open, error: openError } = await db.from("entries").select("id").eq("classifies_entry_id", id).not("status", "in", "(Rejected,Cancelled)");
  dbError(openError);
  if (open?.length) {
    const r = await db.from("entries").select("id").in("reverses_entry_id", open.map((o) => o.id)).not("status", "in", "(Rejected,Cancelled)");
    dbError(r.error);
    if ((r.data ?? []).length < open.length) badRequest("This movement is already classified.");
  }
  const { data, error } = await db.rpc("create_entries", { p_user: user.id, p_entries: [toDbEntry(entry)], p_submit: true });
  dbError(error);
  const target = entry.lines.filter((l) => l.account_code !== ACCOUNTS.suspense).map((l) => l.account_code).join(", ");
  await logJudgment(c.env, {
    category: "Reclassification",
    description: `Entry ${id} (${original.description ?? "For Classification"}) classified to ${target}: ${body.reason?.trim()}`,
    decidedBy: user.fullName,
    recordedBy: user.fullName,
  });
  return c.json({ entryIds: data });
});
