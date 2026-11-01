// Financial statements from ledger totals: Income Statement (by profit center, by month, or
// compared), Balance Sheet, and the direct-method Cash Flow Statement. Amounts in centavos.

import { CASH_ON_HAND } from "./accounts";
import { type AccountTotal, trialBalance, type BookView } from "./ledger";
import { toCents } from "./money";
import type { Account, Book, ProfitCenter } from "./types";

export const TRANSFER_BILLINGS = "4190";
export const DUE_FROM_STORE = "1280";
export const DUE_TO_COMMISSARY = "2180";
export const SUSPENSE = "1195";
export const TRANSFERS_CLEARING = "1190";

// ----------------------------------------------------------------------------------------------
// Income Statement
// ----------------------------------------------------------------------------------------------

export interface StatementTotal {
  period_key: string;
  book: Book;
  account_code: string;
  profit_center: ProfitCenter | null;
  intercompany: boolean;
  debit: number | string;
  credit: number | string;
}

/**
 * business: the whole business (Commissary billings to the Store removed)
 * store / commissary: one book as recorded (billings kept)
 * ggc / nest: one brand from the whole-business view (Shared items stay in the total only)
 */
export type Scope = "business" | "store" | "commissary" | "ggc" | "nest" | "all";
export const SCOPE_LABELS: Record<Scope, string> = {
  all: "Both books as recorded",
  business: "Whole business",
  store: "Store book",
  commissary: "Commissary book",
  ggc: "GGC as a whole",
  nest: "The Nest",
};

/** Profit center of an income or expense line; untagged lines (flagged by the checks) count as GGC. */
export const pcOf = (r: { book: Book; profit_center: ProfitCenter | null }): ProfitCenter =>
  r.book === "Commissary" ? (r.profit_center === "Shared" ? "Shared" : "GGC") : (r.profit_center ?? "GGC");

export function inScope(r: StatementTotal, scope: Scope): boolean {
  switch (scope) {
    case "store":
      return r.book === "Store";
    case "commissary":
      return r.book === "Commissary";
    case "business":
      return !r.intercompany;
    case "ggc":
      return !r.intercompany && pcOf(r) === "GGC";
    case "nest":
      return !r.intercompany && pcOf(r) === "The Nest";
    case "all":
      return true;
  }
}

export type StatementRowKind = "section" | "group" | "line" | "total" | "grand" | "pct";
export interface StatementRow {
  kind: StatementRowKind;
  label: string;
  /** Per column, centavos (or basis points for pct rows). */
  values: Record<string, number>;
  /** 1: show as is (income); -1: show negated (costs shown as positive amounts). */
  sign: 1 | -1;
  codes?: string[];
}

type Section = "revenue" | "discounts" | "cogs" | "opex" | "other";

interface LineDef {
  section: Section;
  group: string;
  label: string;
  order: string;
}

/** Where an income statement account goes. Lines follow the chart's statement lines. */
export function incomeLine(a: Account | undefined, code: string): LineDef {
  const name = a?.name ?? code;
  const line = a?.statementLine || name;
  const type = a?.type ?? "";
  if (type === "Contra-Revenue") return { section: "discounts", group: "", label: "Less: Sales Discounts", order: code };
  if (type === "Revenue" || (!a && code.startsWith("4"))) return { section: "revenue", group: "", label: line, order: code };
  if (type === "COGS" || (!a && code.startsWith("5"))) {
    if (code === "5199") return { section: "cogs", group: "~", label: "Inventory Adjustment (from month-end count)", order: "9" + code };
    if (code.startsWith("52")) return { section: "cogs", group: "The Nest", label: name, order: code };
    return { section: "cogs", group: "Go Go Chicken ingredients", label: line, order: code };
  }
  if (type === "Other Income/Expense" || (!a && /^[79]/.test(code))) {
    if (code.startsWith("75")) return { section: "other", group: "", label: "Interest Expense", order: "9" + code };
    return { section: "other", group: "", label: line, order: code };
  }
  const g = code.slice(0, 2);
  const group =
    g === "61" ? "Payroll" : g === "62" || g === "63" ? "Occupancy & utilities" : ["64", "65", "66"].includes(g) ? "Store operations" : g === "67" ? "General & administrative" : g === "68" ? "Depreciation & amortization" : "Other operating expenses";
  return { section: "opex", group, label: g === "68" || g === "67" ? name : line, order: code };
}

const SECTION_TITLES: Record<Section, string> = {
  revenue: "Revenue",
  discounts: "Revenue",
  cogs: "Cost of Goods Sold",
  opex: "Operating Expenses",
  other: "Other Income / (Expenses)",
};

/**
 * Builds the income statement. `columnsOf` says which columns a total belongs to (e.g. its
 * profit center and "Total", or its month and "YTD"); values are income effects
 * (credit − debit) and each row says how to show them.
 */
export function incomeStatement(
  totals: StatementTotal[],
  accounts: Map<string, Account>,
  scope: Scope,
  columns: string[],
  columnsOf: (t: StatementTotal) => string[],
): StatementRow[] {
  const lines = new Map<string, { def: LineDef; values: Record<string, number>; codes: Set<string> }>();
  for (const t of totals) {
    if (!/^[4-9]/.test(t.account_code) || !inScope(t, scope)) continue;
    const def = incomeLine(accounts.get(t.account_code), t.account_code);
    const key = `${def.section}|${def.group}|${def.label}`;
    const entry = lines.get(key) ?? { def, values: {}, codes: new Set<string>() };
    const effect = toCents(Number(t.credit)) - toCents(Number(t.debit));
    for (const c of columnsOf(t)) entry.values[c] = (entry.values[c] ?? 0) + effect;
    entry.codes.add(t.account_code);
    if (def.order < entry.def.order) entry.def = def; // a line sorts by its lowest account code
    lines.set(key, entry);
  }
  const zero = () => Object.fromEntries(columns.map((c) => [c, 0]));
  const sum = (vals: Record<string, number>[]) => {
    const out = zero();
    for (const v of vals) for (const c of columns) out[c] += v[c] ?? 0;
    return out;
  };
  const of = (section: Section) =>
    [...lines.values()].filter((l) => l.def.section === section).sort((a, b) => a.def.order.localeCompare(b.def.order));
  const rows: StatementRow[] = [];
  const push = (kind: StatementRowKind, label: string, values: Record<string, number>, sign: 1 | -1, codes?: Set<string>) =>
    rows.push({ kind, label, values: { ...zero(), ...values }, sign, codes: codes ? [...codes].sort() : undefined });
  const emit = (section: Section, sign: 1 | -1) => {
    let group = "";
    for (const l of of(section)) {
      if (l.def.group && l.def.group !== "~" && l.def.group !== group) push("group", l.def.group, {}, sign);
      group = l.def.group;
      push("line", l.def.label, l.values, sign, l.codes);
    }
  };
  const total = (section: Section) => sum(of(section).map((l) => l.values));

  push("section", SECTION_TITLES.revenue, {}, 1);
  emit("revenue", 1);
  emit("discounts", 1);
  const netSales = sum([total("revenue"), total("discounts")]);
  push("total", "Net Sales", netSales, 1);

  push("section", SECTION_TITLES.cogs, {}, -1);
  emit("cogs", -1);
  const cogs = total("cogs");
  push("total", "Total Cost of Goods Sold", cogs, -1);
  const gross = sum([netSales, cogs]);
  push("grand", "GROSS PROFIT", gross, 1);
  push("pct", "Gross margin %", ratio(gross, netSales, columns), 1);

  push("section", SECTION_TITLES.opex, {}, -1);
  emit("opex", -1);
  const opex = total("opex");
  push("total", "Total Operating Expenses", opex, -1);
  const operating = sum([gross, opex]);
  push("grand", "OPERATING INCOME", operating, 1);

  push("section", SECTION_TITLES.other, {}, 1);
  emit("other", 1);
  const other = total("other");
  push("total", "Total Other Income / (Expenses)", other, 1);
  const net = sum([operating, other]);
  push("grand", "NET INCOME BEFORE TAX", net, 1);
  push("pct", "Net margin %", ratio(net, netSales, columns), 1);
  return rows;
}

/** Basis points (1% = 100) per column; 0 when there are no sales. */
function ratio(top: Record<string, number>, bottom: Record<string, number>, columns: string[]): Record<string, number> {
  return Object.fromEntries(columns.map((c) => [c, bottom[c] ? Math.round((top[c] / bottom[c]) * 10000) : 0]));
}

/** Net income (income effect) per column from income statement rows. */
export const netIncome = (rows: StatementRow[]) => rows.find((r) => r.label === "NET INCOME BEFORE TAX")!.values;

// ----------------------------------------------------------------------------------------------
// Balance Sheet
// ----------------------------------------------------------------------------------------------

type BsSection = "current-assets" | "noncurrent-assets" | "current-liabilities" | "noncurrent-liabilities" | "equity";
interface BsLine {
  section: BsSection;
  label: string;
  match: (code: string, a: Account | undefined) => boolean;
}

const isEwallet = (a: Account | undefined) => !!a && /gcash|e-wallet/i.test(a.name);
const parent = (p: string) => (_: string, a: Account | undefined) => a?.parentCode === p;
const codes = (...cs: string[]) => (c: string) => cs.includes(c);

export const BS_LINES: BsLine[] = [
  { section: "current-assets", label: "Cash on hand", match: (c) => CASH_ON_HAND.has(c) },
  { section: "current-assets", label: "Cash in bank", match: (c, a) => !!a?.isCashAccount && !CASH_ON_HAND.has(c) && !isEwallet(a) },
  { section: "current-assets", label: "E-wallets (GCash)", match: (_, a) => !!a?.isCashAccount && isEwallet(a) },
  { section: "current-assets", label: "Cash in transit and for classification", match: codes(TRANSFERS_CLEARING, SUSPENSE) },
  { section: "current-assets", label: "Sales due for transfer (card, Grab, Foodpanda)", match: parent("1180") },
  { section: "current-assets", label: "Receivable from employees", match: parent("1240") },
  { section: "current-assets", label: "Advances to owners", match: codes("1250") },
  { section: "current-assets", label: "Due from CLD and other related parties", match: codes("1220", "1230") },
  { section: "current-assets", label: "Advances to suppliers", match: codes("1260") },
  { section: "current-assets", label: "Creditable withholding tax", match: codes("1270") },
  { section: "current-assets", label: "Due from Store", match: codes(DUE_FROM_STORE) },
  { section: "current-assets", label: "Inventory – food & packaging", match: codes("1300") },
  { section: "current-assets", label: "Prepaid expenses", match: codes("1430") },
  { section: "noncurrent-assets", label: "Property & equipment, at cost", match: (c, a) => a?.parentCode === "1500" && c !== "1590" },
  { section: "noncurrent-assets", label: "Less: accumulated depreciation", match: parent("1590") },
  { section: "noncurrent-assets", label: "Deferred charges, net of amortization", match: parent("1600") },
  { section: "noncurrent-assets", label: "Refundable deposits", match: (c, a) => a?.parentCode === "1400" && c !== "1430" },
  { section: "current-liabilities", label: "Accounts payable – suppliers", match: codes("2100") },
  { section: "current-liabilities", label: "Reimbursements payable", match: parent("2110") },
  { section: "current-liabilities", label: "Accrued expenses", match: codes("2120") },
  { section: "current-liabilities", label: "Salaries & wages payable", match: codes("2130") },
  { section: "current-liabilities", label: "13th month pay payable", match: codes("2135") },
  { section: "current-liabilities", label: "Gov't contributions payable (SSS, PhilHealth, Pag-IBIG)", match: codes("2141", "2142", "2143") },
  { section: "current-liabilities", label: "Withholding tax payable – compensation", match: codes("2155") },
  { section: "current-liabilities", label: "Due to CLD", match: codes("2170") },
  { section: "current-liabilities", label: "Due to Commissary", match: codes(DUE_TO_COMMISSARY) },
  { section: "current-liabilities", label: "Accrued interest payable", match: codes("2250") },
  { section: "noncurrent-liabilities", label: "Loans payable – owners", match: codes("2260") },
  { section: "equity", label: "Owner's capital", match: (c) => c.startsWith("31") },
  { section: "equity", label: "Retained earnings (accumulated deficit)", match: (c) => c === "3300" },
  { section: "equity", label: "Current year earnings", match: (c) => c === "3400" },
];

const LOANS_CURRENT = "Loans payable – due within 12 months";
const LOANS_LATER = "Loans payable – due after 12 months";

export const BS_SECTIONS: { key: BsSection; title: string; total: string }[] = [
  { key: "current-assets", title: "Current assets", total: "Total Current Assets" },
  { key: "noncurrent-assets", title: "Non-current assets", total: "Total Non-current Assets" },
  { key: "current-liabilities", title: "Current liabilities", total: "Total Current Liabilities" },
  { key: "noncurrent-liabilities", title: "Non-current liabilities", total: "Total Non-current Liabilities" },
  { key: "equity", title: "Equity", total: "Total Equity" },
];

const isLoanAccount = (code: string, a: Account | undefined) => a?.parentCode === "2200" && !["2250", "2260"].includes(code);

/**
 * One column of the balance sheet (debit-positive balances). Loans are split using
 * `loanCurrent`: per loan account, the principal due within 12 months.
 */
export function balanceSheetColumn(
  totals: AccountTotal[],
  accounts: Map<string, Account>,
  view: BookView,
  loanCurrent: Map<string, number>,
): Map<string, { section: BsSection; cents: number; codes: Set<string> }> {
  const out = new Map<string, { section: BsSection; cents: number; codes: Set<string> }>();
  const add = (section: BsSection, label: string, cents: number, code: string) => {
    const e = out.get(label) ?? { section, cents: 0, codes: new Set<string>() };
    e.cents += cents;
    e.codes.add(code);
    out.set(label, e);
  };
  let netIncomeCents = 0;
  for (const r of trialBalance(totals, accounts, view)) {
    const a = accounts.get(r.code);
    if (r.statement === "Income Statement") {
      netIncomeCents += r.balanceCents;
      continue;
    }
    // In the whole business the Store and Commissary owe each other nothing.
    if (view === "Combined" && (r.code === DUE_FROM_STORE || r.code === DUE_TO_COMMISSARY)) {
      add("current-assets", "Intercompany difference (should be zero)", r.balanceCents, r.code);
      continue;
    }
    if (isLoanAccount(r.code, a)) {
      const owed = -r.balanceCents;
      const current = Math.max(0, Math.min(owed, loanCurrent.get(r.code) ?? 0));
      add("current-liabilities", LOANS_CURRENT, -current, r.code);
      add("noncurrent-liabilities", LOANS_LATER, -(owed - current), r.code);
      continue;
    }
    const line = BS_LINES.find((l) => l.match(r.code, a));
    if (line) add(line.section, line.label, r.balanceCents, r.code);
    else {
      const asset = a ? a.type === "Asset" || a.type === "Contra-Asset" : r.code.startsWith("1");
      const equity = a ? a.type === "Equity" : r.code.startsWith("3");
      add(asset ? "current-assets" : equity ? "equity" : "current-liabilities", asset ? "Other assets" : equity ? "Other equity" : "Other liabilities", r.balanceCents, r.code);
    }
  }
  add("equity", "Net income, year to date", netIncomeCents, "");
  return out;
}

/** The balance sheet rows for several dates (columns), in the standard order. */
export function balanceSheet(columns: { key: string; data: ReturnType<typeof balanceSheetColumn> }[]): StatementRow[] {
  const rows: StatementRow[] = [];
  const order = [...BS_LINES.map((l) => l.label), LOANS_CURRENT, LOANS_LATER, "Other assets", "Intercompany difference (should be zero)", "Other liabilities", "Other equity", "Net income, year to date"];
  const values = (pick: (d: ReturnType<typeof balanceSheetColumn>) => number) => Object.fromEntries(columns.map((c) => [c.key, pick(c.data)]));
  const sectionTotal = (s: BsSection) => values((d) => [...d.values()].filter((e) => e.section === s).reduce((t, e) => t + e.cents, 0));
  const plus = (...vs: Record<string, number>[]) => Object.fromEntries(columns.map((c) => [c.key, vs.reduce((t, v) => t + v[c.key], 0)]));
  for (const [i, s] of BS_SECTIONS.entries()) {
    if (i === 0) rows.push({ kind: "section", label: "ASSETS", values: {}, sign: 1 });
    if (i === 2) rows.push({ kind: "section", label: "LIABILITIES AND EQUITY", values: {}, sign: -1 });
    const sign: 1 | -1 = i < 2 ? 1 : -1;
    rows.push({ kind: "group", label: s.title, values: {}, sign });
    const labels = new Set(columns.flatMap((c) => [...c.data].filter(([, e]) => e.section === s.key).map(([l]) => l)));
    for (const label of order.filter((l) => labels.has(l))) {
      const v = values((d) => d.get(label)?.cents ?? 0);
      const codesUsed = [...new Set(columns.flatMap((c) => [...(c.data.get(label)?.codes ?? [])]))].filter(Boolean).sort();
      if (Object.values(v).some(Boolean) || label === "Net income, year to date") rows.push({ kind: "line", label, values: v, sign, codes: codesUsed });
    }
    rows.push({ kind: "total", label: s.total, values: sectionTotal(s.key), sign });
    if (i === 1) rows.push({ kind: "grand", label: "TOTAL ASSETS", values: plus(sectionTotal("current-assets"), sectionTotal("noncurrent-assets")), sign: 1 });
    if (i === 3) rows.push({ kind: "total", label: "TOTAL LIABILITIES", values: plus(sectionTotal("current-liabilities"), sectionTotal("noncurrent-liabilities")), sign: -1 });
  }
  rows.push({
    kind: "grand",
    label: "TOTAL LIABILITIES AND EQUITY",
    values: plus(sectionTotal("current-liabilities"), sectionTotal("noncurrent-liabilities"), sectionTotal("equity")),
    sign: -1,
  });
  return rows;
}

// ----------------------------------------------------------------------------------------------
// Cash Flow Statement (direct method)
// ----------------------------------------------------------------------------------------------

export interface CashLine {
  entry_id: number;
  entry_date: string;
  book: Book;
  account_code: string;
  debit: number | string;
  credit: number | string;
}

export type CashActivity = "Operating" | "Investing" | "Financing" | "Intercompany" | "Transfers";
export const CASH_CATEGORIES: { key: string; activity: CashActivity; label: string }[] = [
  { key: "sales", activity: "Operating", label: "Receipts from sales" },
  { key: "suppliers", activity: "Operating", label: "Paid for ingredients and to suppliers" },
  { key: "payroll", activity: "Operating", label: "Payroll, contributions and employee advances" },
  { key: "occupancy", activity: "Operating", label: "Rent and utilities" },
  { key: "other-op", activity: "Operating", label: "Other operating expenses and income" },
  { key: "interest", activity: "Operating", label: "Interest paid" },
  { key: "assets", activity: "Investing", label: "Asset purchases" },
  { key: "deposits", activity: "Investing", label: "Refundable deposits paid and refunded" },
  { key: "loans", activity: "Financing", label: "Bank and other loans (proceeds and principal)" },
  { key: "owner-loans", activity: "Financing", label: "Owner loans in and out" },
  { key: "owner-advances", activity: "Financing", label: "Owner advances" },
  { key: "related", activity: "Financing", label: "Related parties (CLD and others)" },
  { key: "capital", activity: "Financing", label: "Capital" },
  { key: "intercompany", activity: "Intercompany", label: "Store ↔ Commissary settlements" },
  { key: "transfers", activity: "Transfers", label: "Transfers with other cash accounts" },
];

/** The cash flow category of the other side of a cash movement. */
export function cashCategory(code: string, a: Account | undefined, cash: Set<string>): string {
  if (cash.has(code) || a?.isCashAccount || code === SUSPENSE || code === TRANSFERS_CLEARING) return "transfers";
  if (code === DUE_FROM_STORE || code === DUE_TO_COMMISSARY) return "intercompany";
  const p = a?.parentCode ?? "";
  if (code.startsWith("4") || p === "1180" || code === "1270") return "sales";
  if (code.startsWith("5") || code === "2100" || code === "1260" || code === "1300") return "suppliers";
  if (code.startsWith("61") || p === "1240" || ["2130", "2135", "2141", "2142", "2143", "2155"].includes(code)) return "payroll";
  if (code.startsWith("62") || code.startsWith("63")) return "occupancy";
  if (code.startsWith("75") || code === "2250") return "interest";
  if (p === "1500" || p === "1590" || p === "1600") return "assets";
  if (p === "1400" && code !== "1430") return "deposits";
  if (code === "2260") return "owner-loans";
  if (code === "1250") return "owner-advances";
  if (["1220", "1230", "2170"].includes(code)) return "related";
  if (p === "2200") return "loans";
  if (code.startsWith("3")) return "capital";
  return "other-op";
}

/**
 * Cash in and out per category. Each entry's net cash movement is spread over the lines on
 * the other side of it (credits when cash came in, debits when it went out), in proportion,
 * so a loan installment splits into principal and interest and an asset bought partly on
 * credit counts only the cash paid. Movements between accounts in `cash` cancel out.
 */
export function cashFlows(lines: CashLine[], accounts: Map<string, Account>, cash: Set<string>, books?: Book[]): Map<string, number> {
  const byEntry = new Map<number, CashLine[]>();
  for (const l of lines) if (!books || books.includes(l.book)) byEntry.set(l.entry_id, [...(byEntry.get(l.entry_id) ?? []), l]);
  const flows = new Map<string, number>();
  for (const entryLines of byEntry.values()) {
    const amt = (l: CashLine) => toCents(Number(l.debit)) - toCents(Number(l.credit));
    const net = entryLines.filter((l) => cash.has(l.account_code)).reduce((s, l) => s + amt(l), 0);
    if (!net) continue;
    const other = entryLines.filter((l) => !cash.has(l.account_code) && (net > 0 ? amt(l) < 0 : amt(l) > 0));
    const weight = other.reduce((s, l) => s + Math.abs(amt(l)), 0);
    if (!weight) {
      flows.set("other-op", (flows.get("other-op") ?? 0) + net);
      continue;
    }
    let left = net;
    other.forEach((l, i) => {
      const part = i === other.length - 1 ? left : Math.round((net * Math.abs(amt(l))) / weight);
      left -= part;
      const cat = cashCategory(l.account_code, accounts.get(l.account_code), cash);
      flows.set(cat, (flows.get(cat) ?? 0) + part);
    });
  }
  return flows;
}

/** Cash accounts for the statement: bank, e-wallet and cash on hand, plus transfers in transit and suspense. */
export function cashAccounts(accounts: Account[], books: Book[]): string[] {
  return [
    ...accounts.filter((a) => a.isCashAccount && !a.isHeader && (a.book === "Both" || books.some((b) => a.book === b))).map((a) => a.code),
    TRANSFERS_CLEARING,
    SUSPENSE,
  ];
}
