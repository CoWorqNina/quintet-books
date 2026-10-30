import { Hono } from "hono";
import type { Account } from "../../shared/types";
import { isOwner, seesEverything } from "../access";
import { type AccountFields, clearCache, createRecords, getAccounts, TABLES, updateRecord } from "../airtable";
import { badRequest, dbError, forbidden } from "../db";
import type { AppContext } from "../env";
import { logJudgment } from "../judgment";
import { serviceClient } from "../supabase";

// Owner setup: adding and deactivating accounts (kept in Airtable) and the registers
// (fixed assets, prepaid and deferred spreads, loans) with their go-live records.
export const setup = new Hono<AppContext>();

// New account under an existing header. It takes its type, statement line, book, profit center
// rule and cash flow group from an account already under that header.
setup.post("/accounts", async (c) => {
  const user = c.get("user");
  if (!isOwner(user)) forbidden("Only an Owner adds accounts.");
  const body = await c.req.json<{ code?: string; name?: string; parentCode?: string; description?: string; reason?: string }>();
  const code = body.code?.trim() ?? "";
  const name = body.name?.trim() ?? "";
  if (!/^\d{4}$/.test(code)) badRequest("The account code is four digits.");
  if (!name) badRequest("Name the account.");
  if (!body.reason?.trim()) badRequest("Say why the account is needed (it goes to the Judgment Log).");
  const accounts = await getAccounts(c.env);
  if (accounts.some((a) => a.code === code)) badRequest(`${code} is already used.`);
  if (accounts.some((a) => a.name.toLowerCase() === name.toLowerCase())) badRequest(`There's already an account named ${name}.`);
  const parent = accounts.find((a) => a.code === body.parentCode && a.isHeader);
  if (!parent) badRequest("Choose the header the account goes under.");
  const sibling = accounts.find((a) => a.parentCode === parent.code && !a.isHeader);
  if (!sibling) badRequest(`${parent.code} has no accounts yet to copy settings from; add this one directly in Airtable.`);

  const fields: AccountFields = {
    Code: code,
    Name: name,
    Type: sibling.type,
    "Normal Balance": sibling.normalBalance ?? undefined,
    Book: sibling.book ?? undefined,
    "Profit Center Rule": sibling.profitCenterRule ?? undefined,
    "Sub-ledger": sibling.subLedger ?? undefined,
    "Cash Flow Group": sibling.cashFlowGroup ?? undefined,
    Statement: sibling.statement,
    "Statement Line": sibling.statementLine,
    "Parent Code": parent.code,
    "Is Header": false,
    "Is Cash Account": sibling.isCashAccount,
    Active: true,
    Description: body.description?.trim() || undefined,
  };
  await createRecords(c.env, TABLES.accounts, [fields]);
  clearCache("accounts:");
  await logJudgment(c.env, {
    category: "New account",
    description: `Added ${code} ${name} under ${parent.code} ${parent.name}: ${body.reason.trim()}`,
    decidedBy: user.fullName,
    recordedBy: user.fullName,
  });
  return c.json({ ok: true });
});

// Deactivate (or reactivate) an account. An account still holding a balance can't be deactivated.
setup.post("/accounts/:code/active", async (c) => {
  const user = c.get("user");
  if (!isOwner(user)) forbidden("Only an Owner changes accounts.");
  const { active, reason } = await c.req.json<{ active: boolean; reason?: string }>();
  if (!reason?.trim()) badRequest("Give a reason.");
  const account = (await getAccounts(c.env)).find((a: Account) => a.code === c.req.param("code"));
  if (!account || account.isHeader) badRequest("Unknown account.");
  if (!active) {
    const db = serviceClient(c.env);
    const [{ data, error }, pending] = await Promise.all([
      db.from("account_period_balances").select("book, debits, credits").eq("account_code", account.code),
      db.from("entry_lines").select("entry_id, entries!inner(status)", { count: "exact", head: true }).eq("account_code", account.code).in("entries.status", ["Draft", "Submitted"]),
    ]);
    dbError(error);
    dbError(pending.error);
    const byBook = new Map<string, number>();
    for (const r of data ?? []) byBook.set(r.book, (byBook.get(r.book) ?? 0) + Math.round(Number(r.debits) * 100) - Math.round(Number(r.credits) * 100));
    if ([...byBook.values()].some((v) => v !== 0)) badRequest(`${account.code} still has a balance. Move it out before deactivating.`);
    if (pending.count) badRequest(`${account.code} is used in entries waiting for approval.`);
  }
  await updateRecord<AccountFields>(c.env, TABLES.accounts, account.id, { Active: active });
  clearCache("accounts:");
  await logJudgment(c.env, {
    category: "Policy decision",
    description: `${active ? "Reactivated" : "Deactivated"} ${account.code} ${account.name}: ${reason.trim()}`,
    decidedBy: user.fullName,
    recordedBy: user.fullName,
  });
  return c.json({ ok: true });
});

setup.get("/registers", async (c) => {
  if (!seesEverything(c.get("user"))) forbidden();
  const { data, error } = await serviceClient(c.env).rpc("registers_overview");
  dbError(error);
  return c.json(data);
});

// Go-live records: assets, spreads and loans that exist on Oct 31, 2026 (matched by the opening balances).
setup.post("/registers", async (c) => {
  const user = c.get("user");
  if (!isOwner(user)) forbidden("Only an Owner records go-live assets, prepaids and loans.");
  const register = await c.req.json<{ type: string; data: Record<string, unknown> }>();
  if (!["asset", "spread", "loan"].includes(register.type)) badRequest("Choose an asset, a spread or a loan.");
  const { data, error } = await serviceClient(c.env).rpc("create_register", { p_user: user.id, p_register: register });
  dbError(error);
  return c.json({ id: data });
});
