// Month-end adjusting entries the app generates for owner approval: depreciation, amortization
// of prepaids and deferred charges, loan interest accrual, the 13th month accrual and the
// inventory adjustment. Each amount is what should be booked by month-end minus what is
// already booked, so a missed month catches up and nothing is booked twice.

import { addMonths } from "./loans";
import { credit, debit, type EntryDraft, type LineDraft } from "./entries";
import { monthEnd } from "./ledger";
import { toCents } from "./money";
import type { Book, ProfitCenter } from "./types";

export const DEPRECIATION_EXPENSE = "6810";
export const THIRTEENTH_MONTH_EXPENSE = "6115";
export const THIRTEENTH_MONTH_PAYABLE = "2135";
export const ACCRUED_INTEREST = "2250";
export const INVENTORY = "1300";
export const INVENTORY_ADJUSTMENT = "5199";
/** Deferred charges are reduced through their own accumulated amortization account. */
export const AMORTIZATION_CONTRA: Record<string, string> = { "1610": "1615", "1620": "1625" };

export type GeneratedKind = "depreciation" | "amortization" | "interest" | "thirteenth" | "inventory";
export const GENERATED_LABELS: Record<GeneratedKind, string> = {
  depreciation: "Depreciation",
  amortization: "Amortization",
  interest: "Interest accrual",
  thirteenth: "13th month accrual",
  inventory: "Inventory adjustment",
};

interface InForce {
  in_force: boolean;
  entry_id: number | null;
  entry_status: string | null;
}
export interface AssetRecord extends InForce {
  id: number;
  name: string;
  book: Book;
  account_code: string;
  accum_account_code: string;
  profit_center: ProfitCenter;
  cost: number | string;
  in_use_date: string;
  useful_life_months: number;
  depreciated_before_go_live: number | string;
  status?: string;
}
export interface SpreadRecord extends InForce {
  id: number;
  name: string;
  book: Book;
  asset_account: string;
  expense_account: string;
  profit_center: ProfitCenter;
  total: number | string;
  start_month: string;
  months: number;
  amortized_before_go_live: number | string;
}
export interface LoanRecord extends InForce {
  id: number;
  name: string;
  book: Book;
  interest_account: string;
  installments: { seq: number; due_date: string; interest: number | string; paid_entry_id: number | null }[] | null;
}

/** Counts once its creating entry is approved (go-live records have no entry). */
const counts = (r: InForce) => r.in_force && (!r.entry_id || r.entry_status === "Approved");

/** Months from the month of `start` to `period` inclusive (0 if `period` is earlier). */
export function monthsThrough(start: string, period: string): number {
  const [y1, m1] = start.slice(0, 7).split("-").map(Number);
  const [y2, m2] = period.split("-").map(Number);
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1) + 1);
}

/** Straight line: equal monthly amounts, the last month taking the rounding difference. */
export function scheduledToDate(totalCents: number, months: number, elapsed: number): number {
  if (elapsed >= months) return totalCents;
  return Math.round(totalCents / months) * elapsed;
}

export interface Generated {
  kind: GeneratedKind;
  book: Book;
  entry: EntryDraft;
  /** One row per register item, for the preview. */
  details: { label: string; cents: number }[];
}

function adjusting(kind: GeneratedKind, book: Book, period: string, lines: LineDraft[], details: Generated["details"]): Generated | null {
  const kept = lines.filter((l) => l.debitCents || l.creditCents);
  if (!kept.length) return null;
  return {
    kind,
    book,
    details,
    entry: {
      kind: "Adjusting",
      transaction_type: null,
      book,
      profit_center: null,
      entry_date: monthEnd(period),
      description: `${GENERATED_LABELS[kind]}, ${period}`,
      reason: `Month-end ${GENERATED_LABELS[kind].toLowerCase()} generated from the ${kind === "thirteenth" ? "payroll entries" : kind === "inventory" ? "inventory count" : "registers"}`,
      lines: kept,
    },
  };
}

/** Sums expense debits by profit center so each entry has one expense line per tag. */
function expenseLines(account: string, byPc: Map<ProfitCenter, number>, templateLine: string): LineDraft[] {
  return [...byPc].filter(([, c]) => c).map(([pc, c]) => (c > 0 ? debit(account, c, templateLine, { profit_center: pc }) : credit(account, -c, templateLine, { profit_center: pc })));
}

const add = <K>(m: Map<K, number>, k: K, v: number) => m.set(k, (m.get(k) ?? 0) + v);
const books = <T extends { book: Book }>(rows: T[]) => [...new Set(rows.map((r) => r.book))];

/**
 * `booked` holds, per register party ("asset:3") and account, the net already booked
 * (debit-positive, centavos) by entries that aren't rejected or cancelled.
 */
export type Booked = Map<string, number>;
export const bookedKey = (party: string, account: string) => `${party}|${account}`;

export function depreciation(period: string, assets: AssetRecord[], booked: Booked): Generated[] {
  const out: Generated[] = [];
  for (const book of books(assets)) {
    const lines: LineDraft[] = [];
    const byPc = new Map<ProfitCenter, number>();
    const details: Generated["details"] = [];
    for (const a of assets.filter((x) => x.book === book && counts(x) && x.status !== "Disposed")) {
      const cost = toCents(Number(a.cost));
      const due = scheduledToDate(cost, a.useful_life_months, monthsThrough(a.in_use_date, period));
      const done = toCents(Number(a.depreciated_before_go_live)) - (booked.get(bookedKey(`asset:${a.id}`, a.accum_account_code)) ?? 0);
      const amount = Math.min(due, cost) - done;
      if (amount <= 0) continue;
      add(byPc, a.profit_center, amount);
      lines.push(credit(a.accum_account_code, amount, "gen.depreciation", { party_id: `asset:${a.id}`, party_name: a.name }));
      details.push({ label: `${a.name} (${a.profit_center})`, cents: amount });
    }
    const g = adjusting("depreciation", book, period, [...expenseLines(DEPRECIATION_EXPENSE, byPc, "gen.expense"), ...lines], details);
    if (g) out.push(g);
  }
  return out;
}

export function amortization(period: string, spreads: SpreadRecord[], booked: Booked): Generated[] {
  const out: Generated[] = [];
  for (const book of books(spreads)) {
    const lines: LineDraft[] = [];
    const details: Generated["details"] = [];
    const expense = new Map<string, Map<ProfitCenter, number>>();
    for (const s of spreads.filter((x) => x.book === book && counts(x))) {
      const total = toCents(Number(s.total));
      const reduce = AMORTIZATION_CONTRA[s.asset_account] ?? s.asset_account;
      const due = scheduledToDate(total, s.months, monthsThrough(s.start_month, period));
      const done = toCents(Number(s.amortized_before_go_live)) - (booked.get(bookedKey(`spread:${s.id}`, reduce)) ?? 0);
      const amount = due - done;
      if (amount <= 0) continue;
      const m = expense.get(s.expense_account) ?? new Map<ProfitCenter, number>();
      add(m, s.profit_center, amount);
      expense.set(s.expense_account, m);
      lines.push(credit(reduce, amount, "gen.amortization", { party_id: `spread:${s.id}`, party_name: s.name }));
      details.push({ label: `${s.name} (${s.profit_center})`, cents: amount });
    }
    const debits = [...expense].flatMap(([account, byPc]) => expenseLines(account, byPc, "gen.expense"));
    const g = adjusting("amortization", book, period, [...debits, ...lines], details);
    if (g) out.push(g);
  }
  return out;
}

/**
 * Interest is accrued for every unpaid installment due by the end of next month, less what is
 * already accrued for that loan (Accrued Interest Payable, cleared by each installment).
 * Interest goes to GGC (loans are taken for the business as a whole).
 */
export function interestAccrual(period: string, loans: LoanRecord[], booked: Booked): Generated[] {
  const out: Generated[] = [];
  const limit = `${addMonths(`${period}-01`, 2)}`; // first day of the month after next
  for (const book of books(loans)) {
    const lines: LineDraft[] = [];
    const details: Generated["details"] = [];
    for (const l of loans.filter((x) => x.book === book && counts(x))) {
      const owed = (l.installments ?? []).filter((i) => !i.paid_entry_id && i.due_date < limit).reduce((s, i) => s + toCents(Number(i.interest)), 0);
      const accrued = -(booked.get(bookedKey(`loan:${l.id}`, ACCRUED_INTEREST)) ?? 0);
      const amount = owed - accrued;
      if (amount <= 0) continue;
      lines.push(
        debit(l.interest_account, amount, "gen.expense", { profit_center: "GGC" }),
        credit(ACCRUED_INTEREST, amount, "gen.interest", { party_id: `loan:${l.id}`, party_name: l.name }),
      );
      details.push({ label: l.name, cents: amount });
    }
    const g = adjusting("interest", book, period, lines, details);
    if (g) out.push(g);
  }
  return out;
}

/** 1/12 of the month's gross pay from the payroll entries, per book and profit center. */
export function thirteenthMonth(period: string, gross: { book: Book; profit_center: ProfitCenter | null; amount: number | string }[]): Generated[] {
  const out: Generated[] = [];
  for (const book of books(gross)) {
    const byPc = new Map<ProfitCenter, number>();
    for (const g of gross.filter((x) => x.book === book)) add(byPc, book === "Commissary" ? "GGC" : (g.profit_center ?? "GGC"), toCents(Number(g.amount)));
    const accrual = new Map([...byPc].map(([pc, c]) => [pc, Math.round(c / 12)] as const));
    const total = [...accrual.values()].reduce((s, c) => s + c, 0);
    const g = adjusting(
      "thirteenth",
      book,
      period,
      [...expenseLines(THIRTEENTH_MONTH_EXPENSE, accrual, "gen.expense"), credit(THIRTEENTH_MONTH_PAYABLE, total, "gen.thirteenth")],
      [...accrual].map(([pc, c]) => ({ label: `${pc}: 1/12 of ${(byPc.get(pc)! / 100).toFixed(2)}`, cents: c })),
    );
    if (g) out.push(g);
  }
  return out;
}

export interface CountLine {
  item: string;
  unit: string;
  quantity: number | string;
  unit_value: number | string;
  account: string;
}

export const countValue = (l: CountLine) => Math.round(Number(l.quantity) * toCents(Number(l.unit_value)));

/**
 * Inventory adjustment for one book and profit center: per item, this count's value against
 * the last count. Any gap between the last count and the ledger's inventory balance (e.g. the
 * opening balance before the first count) is shown on its own line so the ledger ends at the count.
 */
export function inventoryAdjustment(
  period: string,
  book: Book,
  pc: ProfitCenter,
  count: CountLine[],
  previous: CountLine[],
  ledgerCents: number,
): Generated | null {
  const prev = new Map(previous.map((l) => [l.item.toLowerCase(), l]));
  const details: Generated["details"] = [];
  const lines: LineDraft[] = [];
  const seen = new Set<string>();
  const move = (label: string, cents: number) => {
    if (!cents) return;
    details.push({ label, cents });
    lines.push(
      // Inventory lines carry the profit center so each location's stock can be told apart.
      cents > 0
        ? debit(INVENTORY, cents, "gen.inventory", { party_name: label, profit_center: pc })
        : credit(INVENTORY, -cents, "gen.inventory", { party_name: label, profit_center: pc }),
      cents > 0
        ? credit(INVENTORY_ADJUSTMENT, cents, "gen.adjustment", { profit_center: pc, memo: label })
        : debit(INVENTORY_ADJUSTMENT, -cents, "gen.adjustment", { profit_center: pc, memo: label }),
    );
  };
  for (const l of count) {
    const key = l.item.toLowerCase();
    seen.add(key);
    move(l.item, countValue(l) - (prev.get(key) ? countValue(prev.get(key)!) : 0));
  }
  for (const l of previous) if (!seen.has(l.item.toLowerCase())) move(l.item, -countValue(l));
  const previousTotal = previous.reduce((s, l) => s + countValue(l), 0);
  move("Difference between the ledger and the last count", previousTotal - ledgerCents);
  return adjusting("inventory", book, period, lines, details);
}
