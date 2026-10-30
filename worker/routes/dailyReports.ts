import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { buildDailyReport, type DailyReportInput } from "../../shared/dailyReport";
import { toDbEntry } from "../../shared/entries";
import { DAILY_REPORT_ROLES } from "../../shared/templates";
import type { AppUser, DailyReportSummary, Party } from "../../shared/types";
import { checkEntryDate, checkProfitCenter, scopeQuery, seesEverything } from "../access";
import { getAccounts, getParties } from "../airtable";
import { badRequest, dbError, forbidden } from "../db";
import type { AppContext, Env } from "../env";
import { getUserNames } from "../journal";
import { serviceClient } from "../supabase";
import { cleanAttachments } from "./attachments";

export const dailyReports = new Hono<AppContext>();

function employeeLookup(parties: Party[]) {
  const employees = new Map(parties.filter((p) => p.type === "Employee" && p.active).map((p) => [p.id, p]));
  return (id: string | null | undefined, what: string) => {
    if (!id) return null;
    const e = employees.get(id);
    if (!e) badRequest(`${what}: that employee isn't in the active Employees list.`);
    return e;
  };
}

/** Rebuilds the report from the request with names, attachments and accounts taken from trusted sources. */
async function prepare(env: Env, user: AppUser, body: DailyReportInput) {
  if (!DAILY_REPORT_ROLES.includes(user.role)) forbidden("Your role can't enter daily reports.");
  checkProfitCenter(user, body.profitCenter);
  checkEntryDate(body.businessDate);

  const [accountList, parties] = await Promise.all([getAccounts(env), getParties(env)]);
  const employee = employeeLookup(parties);
  const cashier = employee(body.drawer?.cashierId, "Cashier");
  const input: DailyReportInput = {
    businessDate: body.businessDate,
    profitCenter: body.profitCenter,
    pos: body.pos,
    discountAccount: body.discountAccount ?? null,
    drawer: { ...body.drawer, cashierId: cashier?.id ?? null, cashierName: cashier?.name ?? null },
    cashIns: Array.isArray(body.cashIns) ? body.cashIns : [],
    paidOuts: (Array.isArray(body.paidOuts) ? body.paidOuts : []).map((p, i) => {
      const e = p.kind === "advance" ? employee(p.employeeId, `Paid-out ${i + 1}`) : null;
      return {
        ...p,
        employeeId: e?.id,
        employeeName: e?.name,
        receipt: cleanAttachments(p.receipt ? [p.receipt] : [])[0] ?? null,
      };
    }),
    foodCharges: (Array.isArray(body.foodCharges) ? body.foodCharges : []).map((f, i) => {
      const e = employee(f.employeeId, `Food charge ${i + 1}`);
      return { employeeId: e?.id ?? "", employeeName: e?.name ?? "", amount: f.amount };
    }),
    attachments: cleanAttachments(body.attachments),
    notes: typeof body.notes === "string" ? body.notes.slice(0, 2000) : undefined,
  };
  const accounts = new Map(accountList.map((a) => [a.code, a]));
  return { input, result: buildDailyReport(input, accounts) };
}

dailyReports.post("/", async (c) => {
  const user = c.get("user");
  const { input, result } = await prepare(c.env, user, await c.req.json());
  if (result.errors.length) return c.json({ error: result.errors[0], errors: result.errors }, 400);

  const report = {
    business_date: input.businessDate,
    profit_center: input.profitCenter,
    pos: { ...input.pos, discountAccount: input.discountAccount },
    drawer: { ...input.drawer, cashIns: input.cashIns, ...result.figures },
    paid_outs: input.paidOuts,
    food_charges: input.foodCharges,
    attachments: input.attachments,
    notes: input.notes ?? null,
  };
  const { data, error } = await serviceClient(c.env).rpc("create_daily_report", {
    p_user: user.id,
    p_report: report,
    p_entries: result.entries.map(toDbEntry),
  });
  dbError(error);
  return c.json({ reportId: data.report_id, entryIds: data.entry_ids, warnings: result.warnings });
});

dailyReports.get("/", async (c) => {
  const user = c.get("user");
  const month = c.req.query("month") ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) badRequest("Choose a month.");
  const db = serviceClient(c.env);
  const [y, m] = month.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  let query = db
    .from("daily_reports")
    .select("id, business_date, profit_center, status, pos, attachments, created_by, created_at, entries(status)")
    .gte("business_date", `${month}-01`)
    .lte("business_date", end)
    .order("business_date", { ascending: false });
  query = scopeQuery(query, user);
  const [{ data, error }, names] = await Promise.all([query, getUserNames(db)]);
  dbError(error);
  const reports: DailyReportSummary[] = (data ?? []).map((r) => {
    const entryStatuses: Record<string, number> = {};
    for (const e of (r.entries ?? []) as { status: string }[]) entryStatuses[e.status] = (entryStatuses[e.status] ?? 0) + 1;
    return {
      id: r.id,
      businessDate: r.business_date,
      profitCenter: r.profit_center,
      status: r.status,
      netSales: Number(r.pos?.net ?? 0),
      createdBy: names.get(r.created_by) ?? "Unknown",
      createdAt: r.created_at,
      entryStatuses,
      attachments: r.attachments ?? [],
    };
  });
  return c.json(reports);
});

// Cancel to re-enter a mistyped report. Not possible once any of its entries is approved.
dailyReports.post("/:id/cancel", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const { reason } = await c.req.json<{ reason?: string }>();
  const db = serviceClient(c.env);
  const { data: report, error } = await db
    .from("daily_reports")
    .select("id, profit_center, created_by")
    .eq("id", id)
    .maybeSingle();
  dbError(error);
  if (!report) throw new HTTPException(404, { message: "Daily report not found." });
  const allowed =
    seesEverything(user) ||
    report.created_by === user.id ||
    (user.role === "Supervisor" && user.profitCenters.includes(report.profit_center));
  if (!allowed) forbidden();
  dbError((await db.rpc("cancel_daily_report", { p_user: user.id, p_id: id, p_reason: reason ?? "" })).error);
  return c.json({ ok: true });
});
