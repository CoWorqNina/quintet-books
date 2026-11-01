import type { SupabaseClient } from "@supabase/supabase-js";
import { ACCOUNTS, CASH_ON_HAND } from "../shared/accounts";
import { CLEARING_ACCOUNTS, CLEARING_LIMIT_DAYS, monthEnd, openItems, type PartyLine, trialBalance, trialBalanceTotals } from "../shared/ledger";
import { formatPeso, toCents } from "../shared/money";
import { GENERATED_LABELS } from "../shared/monthEnd";
import { cashAccounts, cashFlows, type CashLine } from "../shared/statements";
import { DUE_FROM_STORE, DUE_TO_COMMISSARY } from "../shared/templates/commissary";
import type { Account, Book } from "../shared/types";
import { dbError } from "./db";
import { balanceOf, existingGenerated, loadRegisters, proposals, totalsAt } from "./monthEnd";

export interface Check {
  key: string;
  label: string;
  /** fail blocks the close; warn is shown for review only. */
  status: "pass" | "fail" | "warn";
  details: string[];
}

const peso = (c: number) => formatPeso(c);
const BOOKS: Book[] = ["Store", "Commissary"];

/** Every month-end check (Section 10) and close checklist item for one month. */
export async function runChecks(db: SupabaseClient, period: string, accounts: Map<string, Account>, today: string): Promise<Check[]> {
  const asOf = monthEnd(period);
  const [totals, registers, generated, proposed, entriesRes, reportsRes, recsRes, countsRes, partyRes, periodsRes] = await Promise.all([
    totalsAt(db, period),
    loadRegisters(db),
    existingGenerated(db, period),
    proposals(db, period),
    db.from("entries").select("id, kind, status, entry_date, unsupported, description, entry_lines(account_code, profit_center, party_id, party_name, debit, credit)").eq("period_key", period).limit(5000),
    db.rpc("daily_report_days", { p_period: period }),
    db.from("reconciliations").select("account_code, book, statement_balance, items").eq("period_key", period),
    db.from("inventory_counts").select("id, book, profit_center, entry_id").eq("period_key", period),
    db.rpc("party_lines", { p_accounts: ["2100", "1241", "1242", "1243", "1244", "2260", "1250", "2250", ...CLEARING_ACCOUNTS], p_to: asOf }),
    db.from("periods").select("key, status").lt("key", period).eq("status", "Open"),
  ]);
  for (const r of [entriesRes, reportsRes, recsRes, countsRes, partyRes, periodsRes]) dbError(r.error);
  type Line = { account_code: string; profit_center: string | null; party_id: string | null; party_name: string | null; debit: number; credit: number };
  type Entry = { id: number; kind: string; status: string; entry_date: string; unsupported: boolean; description: string | null; entry_lines: Line[] };
  const entries = (entriesRes.data ?? []) as Entry[];
  const approved = entries.filter((e) => e.status === "Approved");
  const checks: Check[] = [];
  const add = (key: string, label: string, details: string[], warnOnly = false) =>
    checks.push({ key, label, status: details.length ? (warnOnly ? "warn" : "fail") : "pass", details });

  // Close checklist 0: months close in order.
  add("earlier", "Earlier months are closed", (periodsRes.data ?? []).map((p) => `${p.key} is still open`));
  add("ended", "The month has ended", asOf > today ? [`Close after ${asOf}`] : []);

  // 1. Daily reports encoded; nothing left waiting.
  const days = new Set((reportsRes.data ?? []).map((r: { business_date: string; profit_center: string }) => `${r.business_date}|${r.profit_center}`));
  const missing: string[] = [];
  for (const pc of ["GGC", "The Nest"]) {
    const gaps: string[] = [];
    for (let d = new Date(`${period}-01T00:00:00Z`); d.toISOString().slice(0, 10) <= asOf && d.toISOString().slice(0, 10) <= today; d.setUTCDate(d.getUTCDate() + 1)) {
      const day = d.toISOString().slice(0, 10);
      if (!days.has(`${day}|${pc}`)) gaps.push(day.slice(8));
    }
    if (gaps.length) missing.push(`${pc}: no report for day ${gaps.join(", ")}${gaps.length > 3 ? " (fine if the store was closed)" : ""}`);
  }
  add("daily", "Daily reports encoded for every day", missing, true);
  const pending = entries.filter((e) => e.status === "Draft" || e.status === "Submitted");
  add("pending", "No entries left in Draft or Submitted", pending.length ? [`${pending.length} entries waiting: #${pending.slice(0, 10).map((e) => e.id).join(", #")}${pending.length > 10 ? "…" : ""}`] : []);

  // 2. Clearing accounts settled on time.
  const plines = (partyRes.data ?? []) as PartyLine[];
  const late: string[] = [];
  for (const code of CLEARING_ACCOUNTS) {
    const { items } = openItems(plines.filter((l) => l.account_code === code), "debit", asOf);
    const overdue = items.filter((i) => i.ageDays > CLEARING_LIMIT_DAYS[code]);
    if (overdue.length) late.push(`${code} ${accounts.get(code)?.name ?? ""}: ${peso(overdue.reduce((s, i) => s + i.openCents, 0))} older than ${CLEARING_LIMIT_DAYS[code]} days`);
  }
  add("clearing", "Card, Grab and Foodpanda balances matched to payouts", late);

  // 3. Bank, e-wallet and cash reconciliations.
  const recs = new Map((recsRes.data ?? []).map((r: { account_code: string; book: Book; statement_balance: number; items: { amount: number }[] }) => [`${r.account_code}|${r.book}`, r]));
  const recIssues: string[] = [];
  for (const a of [...accounts.values()].filter((x) => x.isCashAccount && !x.isHeader)) {
    for (const book of BOOKS) {
      if (a.book !== "Both" && a.book !== book) continue;
      const ledger = balanceOf(totals, a.code, book);
      const rec = recs.get(`${a.code}|${book}`);
      const used = totals.some((t) => t.account_code === a.code && t.book === book);
      if (!rec) {
        if (used) recIssues.push(`${a.code} ${a.name} (${book}): not reconciled`);
        continue;
      }
      const reconciled = toCents(Number(rec.statement_balance)) + (rec.items ?? []).reduce((s, i) => s + toCents(Number(i.amount)), 0);
      if (reconciled !== ledger) recIssues.push(`${a.code} ${a.name} (${book}): ${CASH_ON_HAND.has(a.code) ? "count" : "statement"} plus reconciling items is ${peso(reconciled)}, ledger is ${peso(ledger)}`);
    }
  }
  add("recs", "Bank, GCash, MariBank and cash on hand reconciled", recIssues);

  // 4. Suspense cleared.
  const suspense = BOOKS.map((b) => [b, balanceOf(totals, ACCOUNTS.suspense, b)] as const).filter(([, v]) => v);
  add("suspense", "Suspense – For Classification is zero", suspense.map(([b, v]) => `${b}: ${peso(v)} still to classify`));

  // 5. Intercompany.
  const dueFrom = balanceOf(totals, DUE_FROM_STORE, "Commissary");
  const dueTo = -balanceOf(totals, DUE_TO_COMMISSARY, "Store");
  add("intercompany", "Due to Commissary equals Due from Store", dueFrom === dueTo ? [] : [`Due from Store ${peso(dueFrom)}, Due to Commissary ${peso(dueTo)}`]);

  // 6. Adjusting entries generated and approved.
  const adj: string[] = [];
  for (const p of proposed) {
    const done = generated.find((g) => g.generated === p.kind && g.book === p.book);
    if (!done) adj.push(`${GENERATED_LABELS[p.kind]} (${p.book}) not generated yet`);
  }
  for (const g of generated) if (g.status !== "Approved") adj.push(`${GENERATED_LABELS[g.generated] ?? g.generated} (${g.book}) entry #${g.id} is ${g.status}`);
  for (const c of (countsRes.data ?? []) as { book: Book; profit_center: string; entry_id: number | null }[]) {
    if (!c.entry_id) adj.push(`Inventory count ${c.book} / ${c.profit_center}: adjustment not generated`);
  }
  add("adjustments", "Adjusting entries posted and approved", adj);

  // Section 10 checks.
  const tb: string[] = [];
  for (const view of ["Store", "Commissary", "Combined"] as const) {
    const t = trialBalanceTotals(trialBalance(totals, accounts, view));
    if (t.debitCents !== t.creditCents) tb.push(`${view}: debits ${peso(t.debitCents)}, credits ${peso(t.creditCents)}`);
  }
  add("tb", "Trial balance balances (per book and combined)", tb);

  const bs: string[] = [];
  for (const view of ["Store", "Commissary", "Combined"] as const) {
    const rows = trialBalance(totals, accounts, view);
    const sum = (pred: (a: Account | undefined, code: string) => boolean) => rows.filter((r) => pred(accounts.get(r.code), r.code)).reduce((s, r) => s + r.balanceCents, 0);
    const assets = sum((a, c) => (a ? a.type === "Asset" || a.type === "Contra-Asset" : c.startsWith("1")));
    const liabEq = -sum((a, c) => (a ? a.type === "Liability" || a.type === "Equity" : /^[23]/.test(c)));
    const netIncome = -sum((a) => a?.statement === "Income Statement");
    if (assets !== liabEq + netIncome) bs.push(`${view}: assets ${peso(assets)}, liabilities and equity ${peso(liabEq + netIncome)}`);
  }
  add("bs", "Balance sheet: assets equal liabilities plus equity", bs);

  const loanIssues: string[] = [];
  for (const l of (registers.loans ?? []).filter((x) => x.in_force && (!x.entry_id || x.entry_status === "Approved"))) {
    const remaining = toCents(Number(l.principal)) - (l.installments ?? []).filter((i) => i.paid_entry_id).reduce((s, i) => s + toCents(Number(i.principal)), 0);
    const ledger = -balanceOf(totals, l.account_code, l.book);
    if (remaining !== ledger) loanIssues.push(`${l.name}: tracker ${peso(remaining)}, ${l.account_code} balance ${peso(ledger)}`);
  }
  add("loans", "Each loan balance equals its Loan Tracker", loanIssues);

  const faIssues: string[] = [];
  const liveAssets = (registers.assets ?? []).filter((a) => a.in_force && (!a.entry_id || a.entry_status === "Approved") && a.status !== "Disposed");
  for (const code of [...new Set(liveAssets.map((a) => a.account_code))]) {
    for (const book of BOOKS) {
      const reg = liveAssets.filter((a) => a.account_code === code && a.book === book).reduce((s, a) => s + toCents(Number(a.cost)), 0);
      const ledger = balanceOf(totals, code, book);
      if (reg && reg !== ledger) faIssues.push(`${code} ${accounts.get(code)?.name ?? ""} (${book}): register ${peso(reg)}, ledger ${peso(ledger)}`);
    }
  }
  add("assets", "Fixed asset cost agrees with the register", faIssues);

  const noParty: string[] = [];
  const interestUntagged = plines.filter((l) => l.account_code === "2250" && !l.party_id?.startsWith("loan:"));
  if (interestUntagged.length) noParty.push(`2250 Accrued Interest Payable: ${interestUntagged.length} lines not tagged to a loan (e.g. entry #${interestUntagged[0].entry_id})`);
  for (const code of ["2100", "1241", "1242", "1243", "1244", "2260", "1250"]) {
    const missingParty = plines.filter((l) => l.account_code === code && !l.party_id && !l.party_name);
    if (missingParty.length) noParty.push(`${code} ${accounts.get(code)?.name ?? ""}: ${missingParty.length} lines without a person or supplier (e.g. entry #${missingParty[0].entry_id})`);
  }
  add("subledgers", "Sub-ledgers equal their control accounts", noParty);

  const untagged = approved.flatMap((e) =>
    e.entry_lines.filter((l) => accounts.get(l.account_code)?.statement === "Income Statement" && !l.profit_center).map(() => `Entry #${e.id}`),
  );
  add("tags", "Every revenue and expense line has a profit center", [...new Set(untagged)].slice(0, 20));

  // Cash: per cash account, the month's cash flow (opening + inflows − outflows) ends at the ledger balance.
  const cashList = [...accounts.values()].filter((a) => a.isCashAccount && !a.isHeader);
  const allCash = cashAccounts([...accounts.values()], BOOKS);
  const prevEnd = new Date(Date.parse(`${period}-01T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const [cashRes, openTotals] = await Promise.all([
    db.rpc("cash_entry_lines", { p_from: `${period}-01`, p_to: asOf, p_cash: allCash }),
    db.rpc("account_totals", { p_to: prevEnd, p_year_start: `${prevEnd.slice(0, 4)}-01-01`, p_mode: "adjusted" }),
  ]);
  dbError(cashRes.error);
  dbError(openTotals.error);
  const cashIssues: string[] = [];
  for (const a of cashList) {
    for (const book of BOOKS) {
      if (a.book !== "Both" && a.book !== book) continue;
      const flows = cashFlows(((cashRes.data ?? []) as CashLine[]).filter((l) => l.book === book), accounts, new Set([a.code]), [book]);
      const end = balanceOf((openTotals.data ?? []) as typeof totals, a.code, book) + [...flows.values()].reduce((x, y) => x + y, 0);
      const ledger = balanceOf(totals, a.code, book);
      if (end !== ledger) cashIssues.push(`${a.code} ${a.name} (${book}): cash flow ends at ${peso(end)}, balance sheet ${peso(ledger)}`);
    }
  }
  add("cash", "Cash flow closing cash equals balance sheet cash", cashIssues);

  // Data quality (for review).
  const quality: string[] = [];
  const unsupported = approved.filter((e) => e.unsupported);
  if (unsupported.length) quality.push(`${unsupported.length} expenses without a receipt: #${unsupported.slice(0, 10).map((e) => e.id).join(", #")}`);
  const seen = new Map<string, number>();
  for (const e of approved.filter((x) => x.kind === "Template")) {
    const supplier = e.entry_lines.find((l) => l.party_id?.startsWith("rec"))?.party_name;
    if (!supplier) continue;
    const total = e.entry_lines.reduce((s, l) => s + toCents(Number(l.debit)), 0);
    const key = `${e.entry_date}|${supplier}|${total}`;
    if (seen.has(key)) quality.push(`Possible duplicate: #${seen.get(key)} and #${e.id} (${supplier}, ${peso(total)}, ${e.entry_date})`);
    else seen.set(key, e.id);
  }
  add("quality", "Data quality: duplicates and missing receipts", quality, true);

  return checks;
}
