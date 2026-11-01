import { Hono } from "hono";
import { addMonths } from "../../shared/loans";
import { type AccountTotal, type BookView, monthEnd, yearStart } from "../../shared/ledger";
import { toCents } from "../../shared/money";
import {
  balanceSheet,
  balanceSheetColumn,
  CASH_CATEGORIES,
  cashAccounts,
  cashFlows,
  type CashLine,
  incomeStatement,
  pcOf,
  type Scope,
  SCOPE_LABELS,
  type StatementRow,
  type StatementTotal,
} from "../../shared/statements";
import type { Account, Book } from "../../shared/types";
import { seesEverything, todayManila } from "../access";
import { getAccounts } from "../airtable";
import { badRequest, dbError, forbidden } from "../db";
import type { AppContext } from "../env";
import { loadRegisters } from "../monthEnd";
import { serviceClient } from "../supabase";

// Financial statements (Owner and Accountant). Approved entries only; a range is "Final" only
// when every month in it is closed.
export const statements = new Hono<AppContext>();

statements.use("/*", async (c, next) => {
  if (!seesEverything(c.get("user"))) forbidden("Only an Owner or the Accountant sees the statements.");
  await next();
});

type DB = ReturnType<typeof serviceClient>;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (p: string) => `${MONTHS[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}`;
export const prevPeriod = (p: string) => addMonths(`${p}-01`, -1).slice(0, 7);
export const dayBefore = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

function periodParam(v: string | undefined): string {
  const p = v ?? todayManila().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(p)) badRequest("Choose a month.");
  return p;
}
function viewParam(v: string | undefined): BookView {
  const view = (v ?? "Combined") as BookView;
  if (!["Combined", "Store", "Commissary"].includes(view)) badRequest("Choose the whole business, Store or Commissary.");
  return view;
}
const accountMap = async (env: AppContext["Bindings"]) => {
  const list = await getAccounts(env);
  return { list, map: new Map(list.map((a) => [a.code, a])) };
};

/** Preliminary unless every month from `from` to `to` is Final. */
export async function status(db: DB, from: string, to: string): Promise<"Final" | "Preliminary"> {
  const { data, error } = await db.from("periods").select("status").gte("key", from.slice(0, 7)).lte("key", to.slice(0, 7));
  dbError(error);
  return data?.length && data.every((p) => p.status === "Final") ? "Final" : "Preliminary";
}

export async function statementTotals(db: DB, from: string, to: string): Promise<StatementTotal[]> {
  const { data, error } = await db.rpc("statement_totals", { p_from: from, p_to: to });
  dbError(error);
  return (data ?? []) as StatementTotal[];
}

export async function totalsAt(db: DB, asOf: string): Promise<AccountTotal[]> {
  const { data, error } = await db.rpc("account_totals", { p_to: asOf, p_year_start: yearStart(asOf), p_mode: "adjusted" });
  dbError(error);
  return (data ?? []) as AccountTotal[];
}

// Income Statement ---------------------------------------------------------------------------

statements.get("/income", async (c) => {
  const period = periodParam(c.req.query("period"));
  const layout = c.req.query("layout") ?? "month";
  const scope = (c.req.query("scope") ?? "business") as Scope;
  if (!(scope in SCOPE_LABELS)) badRequest("Unknown view.");
  const db = serviceClient(c.env);
  const end = monthEnd(period);
  const ytdFrom = yearStart(end);
  const { map } = await accountMap(c.env);
  let columns: { key: string; label: string; kind?: "pct" | "change" }[];
  let from: string;
  let columnsOf: (t: StatementTotal) => string[];
  let title: string;
  let subtitle: string;

  if (layout === "month" || layout === "ytd") {
    from = layout === "month" ? `${period}-01` : ytdFrom;
    const byPc = scope === "business";
    columns = byPc ? ["GGC", "The Nest", "Shared", "Total"].map((k) => ({ key: k, label: k })) : [{ key: "Amount", label: "Amount" }];
    columnsOf = byPc ? (t) => [pcOf(t), "Total"] : () => ["Amount"];
    title = layout === "month" ? "Income Statement" : "Income Statement – Year to Date";
    subtitle = layout === "month" ? `For the month ended ${end}` : `${ytdFrom} to ${end}`;
  } else if (layout === "monthly") {
    from = ytdFrom;
    const months: string[] = [];
    for (let p = ytdFrom.slice(0, 7); p <= period; p = addMonths(`${p}-01`, 1).slice(0, 7)) months.push(p);
    columns = [...months.map((m) => ({ key: m, label: MONTHS[Number(m.slice(5)) - 1] })), { key: "YTD", label: "YTD total" }, { key: "pctSales", label: "% of sales", kind: "pct" as const }];
    columnsOf = (t) => [t.period_key, "YTD"];
    title = "Income Statement – Month by Month";
    subtitle = `Year to date, ${monthLabel(ytdFrom.slice(0, 7))} to ${monthLabel(period)}`;
  } else if (layout === "compare") {
    const prev = prevPeriod(period);
    from = `${prev}-01` < ytdFrom ? `${prev}-01` : ytdFrom;
    columns = [
      { key: period, label: monthLabel(period) },
      { key: prev, label: monthLabel(prev) },
      { key: "change", label: "Change %", kind: "change" as const },
      { key: "YTD", label: `YTD ${period.slice(0, 4)}` },
    ];
    columnsOf = (t) => [...(t.period_key === period || t.period_key === prev ? [t.period_key] : []), ...(t.period_key >= ytdFrom.slice(0, 7) ? ["YTD"] : [])];
    title = "Income Statement – This Month vs Year to Date";
    subtitle = monthLabel(period);
  } else badRequest("Unknown layout.");

  const totals = await statementTotals(db, from, end);
  const valueKeys = columns.filter((k) => !k.kind).map((k) => k.key);
  const rows = incomeStatement(totals, map, scope, valueKeys, columnsOf);
  addDerived(rows, columns, valueKeys);
  return c.json({ title, subtitle, scope, scopeLabel: SCOPE_LABELS[scope], status: await status(db, from, end), columns, rows });
});

/** Change % (this month vs last) and % of net sales columns, in basis points. */
function addDerived(rows: StatementRow[], columns: { key: string; kind?: string }[], valueKeys: string[]) {
  const netSales = rows.find((r) => r.label === "Net Sales")!.values;
  for (const r of rows) {
    if (r.kind === "section" || r.kind === "group") continue;
    for (const col of columns) {
      if (col.kind === "change") {
        const [now, before] = valueKeys;
        const b = r.values[before];
        // On the amounts as shown (costs positive), so a rising cost reads as a positive change.
        r.values.change = r.kind === "pct" ? r.values[now] - b : b ? Math.round(((r.sign * (r.values[now] - b)) / Math.abs(b)) * 10000) : 0;
      }
      if (col.kind === "pct") r.values.pctSales = r.kind === "pct" ? r.values.YTD : netSales.YTD ? Math.round(((r.sign * r.values.YTD) / netSales.YTD) * 10000) : 0;
    }
  }
}

// Balance Sheet ------------------------------------------------------------------------------

/** Loan principal due within 12 months of `asOf`, per Loans Payable account, from the Loan Tracker. */
export async function loansDueWithinYear(db: DB, asOf: string): Promise<Map<string, number>> {
  const registers = await loadRegisters(db);
  const limit = addMonths(asOf, 12);
  const out = new Map<string, number>();
  for (const l of registers.loans ?? []) {
    if (!l.in_force || (l.entry_id && l.entry_status !== "Approved")) continue;
    const due = (l.installments ?? [])
      .filter((i) => (i.due_date > asOf && i.due_date <= limit) || (i.due_date <= asOf && !i.paid))
      .reduce((s, i) => s + toCents(Number(i.principal)), 0);
    out.set(l.account_code, (out.get(l.account_code) ?? 0) + due);
  }
  return out;
}

statements.get("/balance", async (c) => {
  const period = periodParam(c.req.query("period"));
  const view = viewParam(c.req.query("view"));
  const db = serviceClient(c.env);
  const prev = prevPeriod(period);
  const dates = [monthEnd(period), monthEnd(prev)];
  const { map } = await accountMap(c.env);
  const columns = await Promise.all(
    dates.map(async (d) => ({ key: d, data: balanceSheetColumn(await totalsAt(db, d), map, view, await loansDueWithinYear(db, d)) })),
  );
  const rows = balanceSheet(columns);
  const assets = rows.find((r) => r.label === "TOTAL ASSETS")!.values;
  const le = rows.find((r) => r.label === "TOTAL LIABILITIES AND EQUITY")!.values;
  return c.json({
    title: "Balance Sheet",
    subtitle: `As of ${dates[0]}`,
    view,
    status: await status(db, `${period}-01`, dates[0]),
    columns: dates.map((d) => ({ key: d, label: d })),
    rows,
    balanced: dates.every((d) => assets[d] + le[d] === 0),
  });
});

// Cash Flow ----------------------------------------------------------------------------------

export async function cashLines(db: DB, from: string, to: string, cash: string[]): Promise<CashLine[]> {
  const { data, error } = await db.rpc("cash_entry_lines", { p_from: from, p_to: to, p_cash: cash });
  dbError(error);
  return (data ?? []) as CashLine[];
}

export const sumBalances = (totals: AccountTotal[], codes: Set<string>, books: Book[]) =>
  totals
    .filter((t) => codes.has(t.account_code) && books.includes(t.book))
    .reduce((s, t) => s + toCents(Number(t.prior_debit)) - toCents(Number(t.prior_credit)) + toCents(Number(t.year_debit)) - toCents(Number(t.year_credit)), 0);

function cashRows(flows: Map<string, number>, opening: number, closing: number, activities: string[]): StatementRow[] {
  const rows: StatementRow[] = [];
  const v = (n: number) => ({ Amount: n });
  let net = 0;
  for (const activity of activities) {
    const cats = CASH_CATEGORIES.filter((k) => k.activity === activity);
    const total = cats.reduce((s, k) => s + (flows.get(k.key) ?? 0), 0);
    if (activity !== "Operating" && activity !== "Investing" && activity !== "Financing" && !total && !cats.some((k) => flows.get(k.key))) continue;
    rows.push({ kind: "section", label: `${activity === "Transfers" ? "Transfers" : activity === "Intercompany" ? "Intercompany" : `${activity} activities`}`, values: {}, sign: 1 });
    for (const k of cats) if (flows.get(k.key) || activity === "Operating") rows.push({ kind: "line", label: k.label, values: v(flows.get(k.key) ?? 0), sign: 1 });
    rows.push({ kind: "total", label: `Net cash from ${activity.toLowerCase()}${activity === "Transfers" || activity === "Intercompany" ? "" : " activities"}`, values: v(total), sign: 1 });
    net += total;
  }
  rows.push({ kind: "grand", label: "NET INCREASE / (DECREASE) IN CASH", values: v(net), sign: 1 });
  rows.push({ kind: "line", label: "Cash at the beginning of the period", values: v(opening), sign: 1 });
  rows.push({ kind: "grand", label: "CASH AT THE END OF THE PERIOD", values: v(opening + net), sign: 1 });
  rows.push({ kind: "line", label: "Cash per the balance sheet", values: v(closing), sign: 1 });
  return rows;
}

function rangeParams(c: { req: { query: (k: string) => string | undefined } }) {
  const period = periodParam(c.req.query("period"));
  const range = c.req.query("range") ?? "month";
  const to = monthEnd(period);
  const from = range === "ytd" ? yearStart(to) : `${period}-01`;
  return { period, range, from, to, subtitle: range === "ytd" ? `${from} to ${to}` : `For the month ended ${to}` };
}

statements.get("/cash-flow", async (c) => {
  const { from, to, subtitle } = rangeParams(c);
  const view = viewParam(c.req.query("view"));
  const books: Book[] = view === "Combined" ? ["Store", "Commissary"] : [view];
  const db = serviceClient(c.env);
  const { list, map } = await accountMap(c.env);
  const cash = new Set(cashAccounts(list, books));
  const [lines, opening, closing] = await Promise.all([cashLines(db, from, to, [...cash]), totalsAt(db, dayBefore(from)), totalsAt(db, to)]);
  const flows = cashFlows(lines, map, cash, books);
  const rows = cashRows(flows, sumBalances(opening, cash, books), sumBalances(closing, cash, books), ["Operating", "Investing", "Financing", "Intercompany"]);
  const end = rows.find((r) => r.label === "CASH AT THE END OF THE PERIOD")!.values.Amount;
  const bs = rows.find((r) => r.label === "Cash per the balance sheet")!.values.Amount;
  return c.json({ title: "Cash Flow Statement", subtitle, view, status: await status(db, from, to), columns: [{ key: "Amount", label: "Amount" }], rows, ties: end === bs });
});

// One cash flow per cash account: opening, inflows and outflows by category, closing.
statements.get("/cash-accounts", async (c) => {
  const { from, to, subtitle } = rangeParams(c);
  const db = serviceClient(c.env);
  const { list, map } = await accountMap(c.env);
  const cashList = list.filter((a: Account) => a.isCashAccount && !a.isHeader);
  const all = new Set(cashAccounts(list, ["Store", "Commissary"]));
  const [lines, opening, closing] = await Promise.all([cashLines(db, from, to, [...all]), totalsAt(db, dayBefore(from)), totalsAt(db, to)]);
  const out = [];
  for (const a of cashList) {
    for (const book of ["Store", "Commissary"] as Book[]) {
      if (a.book !== "Both" && a.book !== book) continue;
      const one = new Set([a.code]);
      const flows = cashFlows(lines.filter((l) => l.book === book), map, one, [book]);
      const open = sumBalances(opening, one, [book]);
      const close = sumBalances(closing, one, [book]);
      if (!open && !close && ![...flows.values()].some(Boolean)) continue;
      const rows = cashRows(flows, open, close, ["Operating", "Investing", "Financing", "Intercompany", "Transfers"]);
      const end = rows.find((r) => r.label === "CASH AT THE END OF THE PERIOD")!.values.Amount;
      out.push({ code: a.code, name: a.name, book, rows, ties: end === close });
    }
  }
  return c.json({ title: "Cash Flow per Account", subtitle, status: await status(db, from, to), accounts: out });
});
