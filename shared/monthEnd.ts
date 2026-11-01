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

export type GeneratedKind = "depreciation" | "amortization" | "interest" | "thirteenth" | "inventory" | "allowance";
export const GENERATED_LABELS: Record<GeneratedKind, string> = {
  depreciation: "Depreciation",
  amortization: "Amortization",
  interest: "Interest accrual",
  thirteenth: "13th month accrual",
  inventory: "Inventory adjustment",
  allowance: "Owner food above allowance",
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
/** One schedule row as the registers report it. */
export interface LoanRow {
  id: number;
  seq: number;
  due_date: string;
  principal: number | string;
  interest: number | string;
  /** Paid before go-live or by a payment entry in force. */
  paid: boolean;
  /** Interest booked once: by the month-end accrual, by the payment, or before go-live. */
  interest_recorded: boolean;
  interest_entry_id?: number | null;
  interest_status?: string | null;
  /** Unpaid at go-live with its interest in the opening balances (2250). */
  interest_before_go_live?: boolean;
  paid_entry_id?: number | null;
}

export interface LoanRecord extends InForce {
  id: number;
  name: string;
  book: Book;
  interest_account: string;
  installments: LoanRow[] | null;
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
  /** Saved together with the entry (links the loan rows whose interest it books). */
  register?: { type: "loan_interest"; data: { installment_ids: number[] } };
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
      reason: `Month-end ${GENERATED_LABELS[kind].toLowerCase()} generated from the ${
        kind === "thirteenth" ? "payroll entries" : kind === "inventory" ? "inventory count" : kind === "allowance" ? "owners' food charges" : "registers"
      }`,
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
 * Interest accrual, straight-line: for each schedule row due in the closing month (or an
 * earlier month since go-live) whose interest isn't recorded yet, Dr the loan's interest expense /
 * Cr Accrued Interest Payable for that row's interest, and link the row to the entry. Each row's
 * interest is booked exactly once. Interest goes to GGC (loans are for the business as a whole).
 */
export function interestAccrual(period: string, loans: LoanRecord[], goLive: string): Generated[] {
  const out: Generated[] = [];
  const end = monthEnd(period);
  for (const book of books(loans)) {
    const lines: LineDraft[] = [];
    const details: Generated["details"] = [];
    const ids: number[] = [];
    for (const l of loans.filter((x) => x.book === book && counts(x))) {
      for (const r of (l.installments ?? []).filter((i) => !i.interest_recorded && i.due_date >= goLive && i.due_date <= end)) {
        const amount = toCents(Number(r.interest));
        if (!amount) continue;
        lines.push(
          debit(l.interest_account, amount, "gen.expense", { profit_center: "GGC" }),
          credit(ACCRUED_INTEREST, amount, "gen.interest", { party_id: `loan:${l.id}`, party_name: l.name, memo: `Installment ${r.seq}, due ${r.due_date}` }),
        );
        details.push({ label: `${l.name}: installment ${r.seq} (due ${r.due_date})`, cents: amount });
        ids.push(r.id);
      }
    }
    const g = adjusting("interest", book, period, lines, details);
    if (g) out.push({ ...g, register: { type: "loan_interest", data: { installment_ids: ids } } });
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

export const OWNER_FOOD_ALLOWANCE = "6135";
export const RECEIVABLE_OWNER_FOOD = "1255";

/** Approved Owner's Allowance – Food lines for the month (from the general ledger). */
export interface AllowanceLine {
  book: Book;
  party_name: string | null;
  profit_center: ProfitCenter | null;
  debit: number | string;
  credit: number | string;
}

export interface OwnerFoodSummary {
  owner: string;
  /** Food taken at menu price this month. */
  takenCents: number;
  /** Already moved to the owner's receivable this month. */
  movedCents: number;
  /** Still above the allowance and not yet moved. */
  excessCents: number;
  byPc: Map<ProfitCenter, number>;
}

/** Per owner: food taken this month, what is already charged back, and what is still above the allowance. */
export function ownerFoodSummary(lines: AllowanceLine[], allowanceCents: number): OwnerFoodSummary[] {
  const by = new Map<string, OwnerFoodSummary>();
  for (const l of lines) {
    const owner = l.party_name ?? "(no owner)";
    const s = by.get(owner) ?? { owner, takenCents: 0, movedCents: 0, excessCents: 0, byPc: new Map() };
    const d = toCents(Number(l.debit));
    const c = toCents(Number(l.credit));
    s.takenCents += d;
    s.movedCents += c;
    if (d) add(s.byPc, l.profit_center ?? "GGC", d);
    by.set(owner, s);
  }
  for (const s of by.values()) s.excessCents = Math.max(0, s.takenCents - s.movedCents - allowanceCents);
  return [...by.values()].sort((a, b) => a.owner.localeCompare(b.owner));
}

/**
 * Moves each owner's food above the monthly allowance out of Owner's Allowance into
 * Receivable from Owners – Food Charges, split across profit centers in proportion to where
 * the food was taken.
 */
export function ownerAllowanceExcess(period: string, lines: AllowanceLine[], allowanceCents: number, ownerIds: Map<string, string>): Generated[] {
  const out: Generated[] = [];
  for (const book of books(lines)) {
    const entryLines: LineDraft[] = [];
    const details: Generated["details"] = [];
    for (const s of ownerFoodSummary(lines.filter((l) => l.book === book), allowanceCents)) {
      if (!s.excessCents) continue;
      const party = { party_id: ownerIds.get(s.owner) ?? null, party_name: s.owner };
      const pcs = [...s.byPc].filter(([, v]) => v > 0);
      let left = s.excessCents;
      pcs.forEach(([pc, taken], i) => {
        const part = i === pcs.length - 1 ? left : Math.round((s.excessCents * taken) / s.takenCents);
        left -= part;
        entryLines.push(credit(OWNER_FOOD_ALLOWANCE, part, "gen.allowance", { ...party, profit_center: pc }));
      });
      entryLines.push(debit(RECEIVABLE_OWNER_FOOD, s.excessCents, "gen.receivable", party));
      details.push({ label: `${s.owner}: took ${(s.takenCents / 100).toFixed(2)}, allowance ${(allowanceCents / 100).toFixed(2)}`, cents: s.excessCents });
    }
    const g = adjusting("allowance", book, period, entryLines, details);
    if (g) out.push(g);
  }
  return out;
}

// ----------------------------------------------------------------------------------------------
// Retiring an asset (broken, lost, sold or given away)
// ----------------------------------------------------------------------------------------------

export const LOSS_ON_DISPOSAL = "7130";
export const EMPLOYEE_CHARGES_ABOVE_BOOK = "7150";
export const RECEIVABLE_DAMAGES = "1244";

export interface DisposalInput {
  date: string;
  reason: string;
  /** Amount charged to an employee who caused the damage or loss (centavos). */
  charge?: { partyId: string; partyName: string; cents: number } | null;
  /** Amount received if it was sold, and where the money went (centavos). */
  sale?: { account: string; cents: number } | null;
}

export interface DisposalFigures {
  costCents: number;
  catchUpCents: number;
  accumulatedCents: number;
  bookValueCents: number;
  lossCents: number;
  gainCents: number;
  chargeAboveBookCents: number;
}

/**
 * Depreciation runs through the month before the asset is retired (none in the month it goes),
 * catching up any month not yet booked. The cost and its accumulated depreciation come off the
 * books; what's left is a loss, reduced by any amount charged to an employee or received from a
 * sale. A charge above book value is other income; a sale above book value is a gain.
 */
export function disposal(asset: AssetRecord, input: DisposalInput, bookedAccumCents: number): { entry: EntryDraft | null; figures: DisposalFigures; errors: string[] } {
  const errors: string[] = [];
  if (!input.reason?.trim()) errors.push("Say what happened to the asset.");
  if (input.date < asset.in_use_date) errors.push("The asset can't be retired before it was put to use.");
  const cost = toCents(Number(asset.cost));
  const prev = addMonths(`${input.date.slice(0, 7)}-01`, -1).slice(0, 7);
  const due = Math.min(cost, scheduledToDate(cost, asset.useful_life_months, monthsThrough(asset.in_use_date, prev)));
  const done = toCents(Number(asset.depreciated_before_go_live)) + bookedAccumCents;
  const catchUp = Math.max(0, due - done);
  const accumulated = Math.min(cost, done + catchUp);
  const bookValue = cost - accumulated;
  const charge = Math.max(0, input.charge?.cents ?? 0);
  const sale = Math.max(0, input.sale?.cents ?? 0);
  if (charge && !input.charge?.partyId) errors.push("Choose the employee being charged.");
  if (sale && !input.sale?.account) errors.push("Choose where the sale money went.");
  const chargeAbove = Math.max(0, charge - bookValue);
  const left = Math.max(0, bookValue - charge);
  const gain = Math.max(0, sale - left);
  const loss = Math.max(0, left - sale);
  const pc = asset.profit_center;
  const party = { party_id: `asset:${asset.id}`, party_name: asset.name };
  const lines: LineDraft[] = [
    debit(DEPRECIATION_EXPENSE, catchUp, "dispose.depreciation", { profit_center: pc }),
    credit(asset.accum_account_code, catchUp, "dispose.accum", party),
    debit(asset.accum_account_code, accumulated, "dispose.accum_off", party),
    debit(RECEIVABLE_DAMAGES, charge, "dispose.charge", { party_id: input.charge?.partyId ?? null, party_name: input.charge?.partyName ?? null }),
    debit(input.sale?.account ?? "", sale, "dispose.sale"),
    debit(LOSS_ON_DISPOSAL, loss, "dispose.loss", { profit_center: pc }),
    credit(asset.account_code, cost, "dispose.cost", party),
    credit(EMPLOYEE_CHARGES_ABOVE_BOOK, chargeAbove, "dispose.charge_above", { profit_center: pc === "Shared" ? "GGC" : pc }),
    credit(LOSS_ON_DISPOSAL, gain, "dispose.gain", { profit_center: pc }),
  ].filter((l) => l.debitCents || l.creditCents);
  const entry: EntryDraft = {
    kind: "Special",
    transaction_type: null,
    book: asset.book,
    profit_center: null,
    entry_date: input.date,
    description: `Asset retired: ${asset.name}`,
    reason: input.reason?.trim() ?? "",
    lines,
  };
  return {
    entry: errors.length ? null : entry,
    figures: { costCents: cost, catchUpCents: catchUp, accumulatedCents: accumulated, bookValueCents: bookValue, lossCents: loss, gainCents: gain, chargeAboveBookCents: chargeAbove },
    errors,
  };
}
