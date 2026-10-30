import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { toDbEntry } from "../../shared/entries";
import { type Field, getTemplate, type Row, type Values } from "../../shared/templates";
import type { JournalEntry } from "../../shared/types";
import type { Book } from "../../shared/types";
import { checkEntryDate, isOwner, scopeQuery, seesEverything } from "../access";
import { getAccounts } from "../airtable";
import { badRequest, dbError, forbidden } from "../db";
import type { AppContext } from "../env";
import { canBatchApprove, ENTRY_SELECT, getUserNames, toJournalEntry, withReversals } from "../journal";
import { serviceClient } from "../supabase";
import { templateContext } from "../templateContext";
import { cleanAttachments } from "./attachments";

export const entries = new Hono<AppContext>();

// New entry from a template. The server rebuilds the lines itself from the submitted values.
entries.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ template: number; book?: Book; profitCenter: "GGC" | "The Nest"; values: Values }>();
  const template = getTemplate(Number(body.template));
  if (!template) badRequest("Unknown transaction type.");
  if (!template.roles.includes(user.role)) forbidden(`Your role can't enter ${template.name}.`);
  const book = template.twoBook ? "Store" : (body.book ?? template.books[0]);
  if (!template.books.includes(book)) badRequest(`${template.name} can't be entered in the ${book} book.`);

  const values = cleanValues(template.fields, body.values ?? {});
  checkEntryDate(String(values.date ?? ""));
  const ctx = await templateContext(c.env, user, template, book, body.profitCenter);
  const { entries: drafts, errors, register } = template.build(values, ctx);
  if (errors.length || !drafts.length) return c.json({ error: errors[0] ?? "Nothing to record.", errors }, 400);

  const form = { template: template.number, book, profitCenter: ctx.profitCenter, values };
  const p_entries = drafts.map((d) => ({ ...toDbEntry(d), form }));
  const db = serviceClient(c.env);
  if (register) {
    // Asset, prepaid or loan entries create their schedule record in the same transaction.
    const { data, error } = await db.rpc("create_entries_with_register", { p_user: user.id, p_entries, p_register: register });
    dbError(error);
    return c.json({ entryIds: data.entry_ids, registerId: data.register_id });
  }
  const { data, error } = await db.rpc("create_entries", { p_user: user.id, p_entries, p_submit: true });
  dbError(error);
  return c.json({ entryIds: data });
});

/** Keeps only attachments this app uploaded, at the top level and inside line rows. */
export function cleanValues(fields: Field[], raw: Values): Values {
  const values: Values = { ...raw };
  for (const f of fields) {
    if (f.type === "attachment") values[f.name] = cleanAttachments(values[f.name] ? [values[f.name]] : [])[0] ?? null;
    if (f.type === "rows") {
      const rows = Array.isArray(values[f.name]) ? (values[f.name] as Row[]) : [];
      values[f.name] = rows.slice(0, 100).map((r) => {
        const row: Row = { ...r };
        for (const col of f.columns ?? []) {
          if (col.type === "attachment") row[col.name] = cleanAttachments(row[col.name] ? [row[col.name]] : [])[0] ?? null;
        }
        return row;
      });
    }
  }
  return values;
}

// Journal: entries with their lines, filtered by the caller's visibility.
entries.get("/", async (c) => {
  const user = c.get("user");
  const db = serviceClient(c.env);
  const period = c.req.query("period");
  const status = c.req.query("status");
  const reportId = c.req.query("dailyReport");
  const entryId = c.req.query("entry");
  let query = db.from("entries").select(ENTRY_SELECT).order("entry_date", { ascending: false }).order("id", { ascending: false });
  if (period) query = query.eq("period_key", period);
  if (status) query = query.eq("status", status);
  if (reportId) query = query.eq("daily_report_id", Number(reportId));
  if (entryId) query = query.or(`id.eq.${Number(entryId)},reverses_entry_id.eq.${Number(entryId)},classifies_entry_id.eq.${Number(entryId)}`);
  query = scopeQuery(query, user).limit(500);
  const [{ data, error }, accounts, names] = await Promise.all([query, getAccounts(c.env), getUserNames(db)]);
  dbError(error);
  const accountMap = new Map(accounts.map((a) => [a.code, a]));
  return c.json(await withReversals(db, (data ?? []).map((r) => toJournalEntry(r, accountMap, names)) as JournalEntry[]));
});

// Approval queue: Submitted entries by other people (nobody approves their own).
entries.get("/approvals", async (c) => {
  const user = c.get("user");
  if (!isOwner(user)) forbidden("Only owners approve entries.");
  const db = serviceClient(c.env);
  const [{ data, error }, accounts, names] = await Promise.all([
    db
      .from("entries")
      .select(ENTRY_SELECT)
      .eq("status", "Submitted")
      .neq("created_by", user.id)
      .order("entry_date")
      .order("id")
      .limit(500),
    getAccounts(c.env),
    getUserNames(db),
  ]);
  dbError(error);
  const accountMap = new Map(accounts.map((a) => [a.code, a]));
  return c.json((data ?? []).map((r) => toJournalEntry(r, accountMap, names)));
});

entries.post("/approve", async (c) => {
  const user = c.get("user");
  if (!isOwner(user)) forbidden("Only owners approve entries.");
  const { ids } = await c.req.json<{ ids: number[] }>();
  if (!Array.isArray(ids) || !ids.length) badRequest("Choose entries to approve.");
  const db = serviceClient(c.env);
  if (ids.length > 1) {
    // Batch approval is only for routine template entries; the rest are approved one by one.
    const { data, error } = await db.from("entries").select("id, kind, transaction_type, unsupported").in("id", ids);
    dbError(error);
    const oneByOne = (data ?? []).filter((r) => !canBatchApprove(r));
    if (oneByOne.length) badRequest(`Entries ${oneByOne.map((r) => r.id).join(", ")} must be approved one by one.`);
  }
  const { data, error } = await db.rpc("approve_entries", { p_user: user.id, p_ids: ids });
  dbError(error);
  return c.json({ approved: data });
});

entries.post("/:id/reject", async (c) => {
  const user = c.get("user");
  if (!isOwner(user)) forbidden("Only owners reject entries.");
  const { reason } = await c.req.json<{ reason?: string }>();
  if (!reason?.trim()) badRequest("Give a reason for rejecting.");
  dbError(
    (await serviceClient(c.env).rpc("reject_entry", { p_user: user.id, p_id: Number(c.req.param("id")), p_reason: reason.trim() }))
      .error,
  );
  return c.json({ ok: true });
});

// Cancel a standalone entry that isn't approved yet (daily report entries are cancelled with their report).
entries.post("/:id/cancel", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const db = serviceClient(c.env);
  const { data: row, error } = await db
    .from("entries")
    .select("id, created_by, profit_center, daily_report_id")
    .eq("id", id)
    .maybeSingle();
  dbError(error);
  if (!row) throw new HTTPException(404, { message: "Entry not found." });
  if (row.daily_report_id) badRequest("This entry belongs to a daily report; cancel the report instead.");
  const allowed =
    seesEverything(user) ||
    row.created_by === user.id ||
    (user.role === "Supervisor" && user.profitCenters.includes(row.profit_center));
  if (!allowed) forbidden();
  dbError((await db.rpc("cancel_entry", { p_user: user.id, p_id: id })).error);
  return c.json({ ok: true });
});
