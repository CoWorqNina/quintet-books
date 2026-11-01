import { Hono } from "hono";
import { addMonths } from "../../shared/loans";
import { monthEnd, yearStart } from "../../shared/ledger";
import { BRAND_COLUMNS, brandIncomeStatement, ratios } from "../../shared/managementReport";
import { formatPeso, toCents } from "../../shared/money";
import { balanceSheet, balanceSheetColumn, CASH_CATEGORIES, cashAccounts, cashFlows, incomeStatement, type StatementRow } from "../../shared/statements";
import type { Book } from "../../shared/types";
import { seesEverything, todayManila } from "../access";
import { getAccounts, listAll, TABLES } from "../airtable";
import { runChecks } from "../checks";
import { badRequest, dbError, forbidden } from "../db";
import type { AppContext } from "../env";
import { OWNER_FOOD_ALLOWANCE_CENTS } from "../../shared/config";
import { ownerFoodSummary, RECEIVABLE_OWNER_FOOD } from "../../shared/monthEnd";
import { loadRegisters, ownerFoodLines } from "../monthEnd";
import { serviceClient } from "../supabase";
import { cashLines, dayBefore, loansDueWithinYear, monthLabel, prevPeriod, statementTotals, status, sumBalances, totalsAt } from "./statements";

// Monthly management report (Section 9): summary, statements, COGS, loans, ratios,
// Judgment Log, red flags and open items. Margins and COGS trends use a rolling 3 months
// because ingredients are expensed when bought.
export const reports = new Hono<AppContext>();

reports.get("/management", async (c) => {
  if (!seesEverything(c.get("user"))) forbidden("Only an Owner or the Accountant sees the management report.");
  const period = c.req.query("period") ?? prevPeriod(todayManila().slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(period)) badRequest("Choose a month.");
  const db = serviceClient(c.env);
  const asOf = monthEnd(period);
  const prev = prevPeriod(period);
  const from3 = `${addMonths(`${period}-01`, -2).slice(0, 7)}-01`;
  const fromAll = from3 < yearStart(asOf) ? from3 : yearStart(asOf);
  const books: Book[] = ["Store", "Commissary"];

  const accountList = await getAccounts(c.env);
  const accounts = new Map(accountList.map((a) => [a.code, a]));
  const cash = new Set(cashAccounts(accountList, books));
  const [totals, bsNow, bsPrev, dueNow, duePrev, cashMonth, cash3, openTotals, registers, checks, journal, payroll, reportStatus, pending, periods] = await Promise.all([
    statementTotals(db, fromAll, asOf),
    totalsAt(db, asOf),
    totalsAt(db, monthEnd(prev)),
    loansDueWithinYear(db, asOf),
    loansDueWithinYear(db, monthEnd(prev)),
    cashLines(db, `${period}-01`, asOf, [...cash]),
    cashLines(db, from3, asOf, [...cash]),
    totalsAt(db, dayBefore(`${period}-01`)),
    loadRegisters(db),
    runChecks(db, period, accounts, todayManila(), c.env),
    listAll<{ Date?: string; Category?: string; Description?: string; "Decided By"?: string }>(c.env, TABLES.judgmentLog),
    db.rpc("gl_lines", { p_account: "2130", p_book: null, p_from: `${period}-01`, p_to: asOf }),
    status(db, `${period}-01`, asOf),
    db.from("entries").select("id", { count: "exact", head: true }).eq("status", "Submitted"),
    db.from("periods").select("key, status").lte("key", period).eq("status", "Open").order("key"),
  ]);
  dbError(payroll.error);
  dbError(pending.error);
  dbError(periods.error);

  // 2. Statements
  const monthTotals = totals.filter((t) => t.period_key === period);
  const income = brandIncomeStatement(monthTotals, accounts);
  const balance = balanceSheet([
    { key: asOf, data: balanceSheetColumn(bsNow, accounts, "Combined", dueNow) },
    { key: monthEnd(prev), data: balanceSheetColumn(bsPrev, accounts, "Combined", duePrev) },
  ]);
  const flows = cashFlows(cashMonth, accounts, cash, books);
  const openingCash = sumBalances(openTotals, cash, books);
  const closingCash = sumBalances(bsNow, cash, books);
  const cashFlow = CASH_CATEGORIES.filter((k) => flows.get(k.key)).map((k) => ({ activity: k.activity, label: k.label, cents: flows.get(k.key)! }));

  // 3. COGS per ingredient, this month and rolling 3 months (whole business)
  const months3 = [0, 1, 2].map((i) => addMonths(`${period}-01`, -i).slice(0, 7));
  const trend = incomeStatement(totals, accounts, "business", ["month", "r3"], (t) => [...(t.period_key === period ? ["month"] : []), ...(months3.includes(t.period_key) ? ["r3"] : [])]);
  const netSales = trend.find((r) => r.label === "Net Sales")!.values;
  const cogsStart = trend.findIndex((r) => r.label === "Cost of Goods Sold");
  const cogsEnd = trend.findIndex((r) => r.label === "Total Cost of Goods Sold");
  const cogs = trend.slice(cogsStart + 1, cogsEnd + 1).filter((r) => r.kind === "line" || r.kind === "total").map((r) => ({
    label: r.label,
    total: r.kind === "total",
    monthCents: -r.values.month,
    monthPct: netSales.month ? Math.round((-r.values.month / netSales.month) * 10000) : 0,
    r3Cents: -r.values.r3,
    r3Pct: netSales.r3 ? Math.round((-r.values.r3 / netSales.r3) * 10000) : 0,
  }));

  // 4. Loans
  const accrued = new Map<string, number>();
  const { data: interestLines, error: ie } = await db.rpc("party_lines", { p_accounts: ["2250"], p_to: asOf });
  dbError(ie);
  for (const l of (interestLines ?? []) as { party_id: string | null; debit: number; credit: number }[]) {
    if (l.party_id) accrued.set(l.party_id, (accrued.get(l.party_id) ?? 0) + toCents(Number(l.credit)) - toCents(Number(l.debit)));
  }
  const soon = addMonths(asOf, 1);
  const loans = (registers.loans ?? [])
    .filter((l) => l.in_force && (!l.entry_id || l.entry_status === "Approved"))
    .map((l) => {
      const inst = l.installments ?? [];
      const unpaid = inst.filter((i) => !i.paid);
      const next = unpaid[0];
      return {
        name: l.name,
        lender: (l as { lender_name?: string }).lender_name ?? "",
        rate: Number((l as { annual_rate?: number }).annual_rate ?? 0),
        principalCents: toCents(Number(l.principal)) - inst.filter((i) => i.paid).reduce((s, i) => s + toCents(Number(i.principal)), 0),
        interestPayableCents: accrued.get(`loan:${l.id}`) ?? 0,
        paid: inst.length - unpaid.length,
        of: inst.length,
        next: next ? { dueDate: next.due_date, cents: toCents(Number(next.principal)) + toCents(Number(next.interest)) } : null,
        overdue: unpaid.filter((i) => i.due_date <= asOf).length,
        dueSoonCents: unpaid.filter((i) => i.due_date > asOf && i.due_date <= soon).reduce((s, i) => s + toCents(Number(i.principal)) + toCents(Number(i.interest)), 0),
      };
    });

  // 4b. Owner's food allowance for the month
  const [food, owedLines] = await Promise.all([ownerFoodLines(db, period), db.rpc("party_lines", { p_accounts: [RECEIVABLE_OWNER_FOOD], p_to: asOf })]);
  dbError(owedLines.error);
  const owed = new Map<string, number>();
  for (const l of (owedLines.data ?? []) as { party_name: string | null; debit: number; credit: number }[]) {
    const k = l.party_name ?? "(no owner)";
    owed.set(k, (owed.get(k) ?? 0) + toCents(Number(l.debit)) - toCents(Number(l.credit)));
  }
  const allowance = ownerFoodSummary(food, OWNER_FOOD_ALLOWANCE_CENTS).map((x) => ({
    owner: x.owner,
    takenCents: x.takenCents,
    allowanceCents: OWNER_FOOD_ALLOWANCE_CENTS,
    chargedBackCents: x.movedCents,
    stillAboveCents: x.excessCents,
    owedCents: owed.get(x.owner) ?? 0,
  }));
  for (const [owner, owedCents] of owed) {
    if (owedCents && !allowance.some((a) => a.owner === owner)) allowance.push({ owner, takenCents: 0, allowanceCents: OWNER_FOOD_ALLOWANCE_CENTS, chargedBackCents: 0, stillAboveCents: 0, owedCents });
  }

  // 5. Ratios: this month and rolling 3 months
  const flows3 = cashFlows(cash3, accounts, cash, books);
  const debtService = -((flows.get("loans") ?? 0) + (flows.get("interest") ?? 0));
  const opOut3 = -CASH_CATEGORIES.filter((k) => k.activity === "Operating").reduce((s, k) => s + Math.min(0, flows3.get(k.key) ?? 0), 0);
  const weeklyBurn = opOut3 / 13;
  const r = { month: ratios(trend, "month"), r3: ratios(trend, "r3") };
  const keyRatios = {
    ...r,
    debtServicePct: netSales.month ? Math.round((debtService / netSales.month) * 10000) : 0,
    runwayWeeks: weeklyBurn > 0 ? Math.round((closingCash / weeklyBurn) * 10) / 10 : null,
  };

  // 1. Summary (up to 5 points), cash first
  const payrollNet = ((payroll.data ?? []) as { credit: number }[]).reduce((s, l) => s + toCents(Number(l.credit)), 0);
  const nextPayroll = Math.round(payrollNet / 2); // two pay periods a month
  const dueSoon = loans.reduce((s, l) => s + l.dueSoonCents, 0);
  const fails = checks.filter((x) => x.status === "fail");
  const summary = [
    `Cash on hand, in banks and e-wallets: ${formatPeso(closingCash)} at ${asOf} (${closingCash >= openingCash ? "up" : "down"} ${formatPeso(Math.abs(closingCash - openingCash))} for the month).`,
    nextPayroll
      ? `Next payroll (about ${formatPeso(nextPayroll)}, half of ${monthLabel(period)}'s net pay) is ${closingCash >= nextPayroll ? "covered" : "NOT covered"} by cash${closingCash >= nextPayroll ? ` ${(closingCash / nextPayroll).toFixed(1)} times over` : ""}.`
      : `No payroll was recorded in ${monthLabel(period)}.`,
    dueSoon ? `Loan payments due in the 30 days after month-end: ${formatPeso(dueSoon)}.` : "No loan payments due in the 30 days after month-end.",
    `Net income before tax: ${formatPeso(netIncome(income, "Total"))} (${(r.month.netMarginPct / 100).toFixed(1)}% of sales; rolling 3 months ${(r.r3.netMarginPct / 100).toFixed(1)}%).`,
    fails.length ? `${fails.length} close check${fails.length > 1 ? "s" : ""} failing: ${fails.map((f) => f.label).join("; ")}.` : "All close checks pass.",
  ];

  // 6. Judgment Log for the month
  const judgment = journal
    .map((j) => j.fields)
    .filter((f) => (f.Date ?? "").startsWith(period))
    .sort((a, b) => (a.Date ?? "").localeCompare(b.Date ?? ""))
    .map((f) => ({ date: f.Date ?? "", category: f.Category ?? "", description: f.Description ?? "", decidedBy: f["Decided By"] ?? "" }));

  // 7–8. Red flags (failing checks, overdue loans) and open items
  const redFlags = [
    ...fails.flatMap((f) => f.details.map((d) => `${f.label}: ${d}`)),
    ...loans.filter((l) => l.overdue).map((l) => `${l.name}: ${l.overdue} installment${l.overdue > 1 ? "s" : ""} overdue`),
    ...(keyRatios.runwayWeeks !== null && keyRatios.runwayWeeks < 4 ? [`Cash runway is only ${keyRatios.runwayWeeks} weeks`] : []),
    ...allowance.filter((a) => a.stillAboveCents).map((a) => `${a.owner} took ${formatPeso(a.stillAboveCents)} of food above the allowance; charge it back at month-end`),
  ];
  const openItems = [
    ...(pending.count ? [`${pending.count} entries waiting for approval`] : []),
    ...allowance.filter((a) => a.owedCents > 0).map((a) => `${a.owner} owes ${formatPeso(a.owedCents)} for food above the allowance (collect with #38)`),
    ...(periods.data ?? []).map((p) => `${p.key} is not yet closed`),
    ...checks.filter((x) => x.status === "warn").flatMap((x) => x.details.map((d) => `${x.label}: ${d}`)),
  ];

  return c.json({
    period,
    label: monthLabel(period),
    asOf,
    status: reportStatus,
    summary,
    income: { columns: BRAND_COLUMNS.map((k) => ({ key: k, label: k })), rows: income },
    balance: { columns: [asOf, monthEnd(prev)].map((k) => ({ key: k, label: k })), rows: balance },
    cashFlow: { openingCents: openingCash, closingCents: closingCash, lines: cashFlow },
    cogs,
    loans,
    allowance,
    ratios: keyRatios,
    judgment,
    redFlags,
    openItems,
  });
});

const netIncome = (rows: StatementRow[], col: string) => rows.find((r) => r.label === "NET INCOME BEFORE TAX")!.values[col] ?? 0;
