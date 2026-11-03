// Calculations behind the ledger views: trial balance from account totals, balances per party,
// and first-in-first-out aging of open items (supplier bills, clearing balances).

import type { Account, Book, ProfitCenter } from "./types";
import { toCents } from "./money";

export const RETAINED_EARNINGS = "3300";
/** The eight COGS ingredients compared across suppliers (Rice to LPG). */
/** Purchases compared across suppliers (price per unit): the inventory categories, where ingredients are now bought into. */
export const INGREDIENT_ACCOUNTS = ["1321", "1322", "1323", "1324", "1325", "1326", "1327", "1328", "1329", "1330"];
export const CLEARING_ACCOUNTS = ["1181", "1182", "1183", "1184", "1185", "1186"];
/** Days a clearing balance may stay unpaid: card 10, Grab and Foodpanda 14. */
export const CLEARING_LIMIT_DAYS: Record<string, number> = { "1181": 10, "1184": 10, "1182": 14, "1183": 14, "1185": 14, "1186": 14 };

export type TrialBalanceMode = "unadjusted" | "adjusted" | "post-closing";
export type BookView = Book | "Combined";

export interface AccountTotal {
  book: Book;
  account_code: string;
  profit_center?: ProfitCenter | null;
  prior_debit: number | string;
  prior_credit: number | string;
  year_debit: number | string;
  year_credit: number | string;
}

export interface TrialBalanceRow {
  code: string;
  name: string;
  type: string;
  statement: "Balance Sheet" | "Income Statement";
  /** Debit-positive balance in centavos. */
  balanceCents: number;
  note?: string;
}

const c = (v: number | string) => toCents(Number(v));

/** Fiscal years follow the calendar year. */
export function yearStart(date: string): string {
  return `${date.slice(0, 4)}-01-01`;
}

export function monthEnd(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * Balance sheet accounts carry everything to date; income statement accounts show the year to
 * date. Earlier years' results not yet closed to Retained Earnings are added to it so the
 * trial balance still balances (year-end closing entries move them for real).
 */
export function trialBalance(totals: AccountTotal[], accounts: Map<string, Account>, view: BookView): TrialBalanceRow[] {
  const byCode = new Map<string, number>();
  let unclosedCents = 0;
  for (const t of totals) {
    if (view !== "Combined" && t.book !== view) continue;
    const a = accounts.get(t.account_code);
    const income = a ? a.statement === "Income Statement" : /^[4-9]/.test(t.account_code);
    const prior = c(t.prior_debit) - c(t.prior_credit);
    const year = c(t.year_debit) - c(t.year_credit);
    if (income) unclosedCents += prior;
    byCode.set(t.account_code, (byCode.get(t.account_code) ?? 0) + year + (income ? 0 : prior));
  }
  const rows: TrialBalanceRow[] = [];
  for (const [code, balanceCents] of byCode) {
    if (!balanceCents && code !== RETAINED_EARNINGS) continue;
    const a = accounts.get(code);
    rows.push({
      code,
      name: a?.name ?? "(not in the chart of accounts)",
      type: a?.type ?? "",
      statement: a?.statement ?? (/^[4-9]/.test(code) ? "Income Statement" : "Balance Sheet"),
      balanceCents,
    });
  }
  if (unclosedCents) {
    const re = rows.find((r) => r.code === RETAINED_EARNINGS);
    const note = "includes earlier years' results not yet closed";
    if (re) Object.assign(re, { balanceCents: re.balanceCents + unclosedCents, note });
    else rows.push({ code: RETAINED_EARNINGS, name: accounts.get(RETAINED_EARNINGS)?.name ?? "Retained Earnings", type: "Equity", statement: "Balance Sheet", balanceCents: unclosedCents, note });
  }
  return rows.filter((r) => r.balanceCents !== 0).sort((a, b) => a.code.localeCompare(b.code));
}

export function trialBalanceTotals(rows: TrialBalanceRow[]) {
  const debitCents = rows.reduce((s, r) => s + Math.max(r.balanceCents, 0), 0);
  const creditCents = rows.reduce((s, r) => s + Math.max(-r.balanceCents, 0), 0);
  return { debitCents, creditCents };
}

export interface PartyLine {
  book: Book;
  account_code: string;
  party_id: string | null;
  party_name: string | null;
  entry_id: number;
  entry_date: string;
  description: string | null;
  debit: number | string;
  credit: number | string;
  /** Line id, the bill line a payment settles, the bill's due date (from 0009_open_items). */
  line_id?: number;
  settles_line_id?: number | null;
  due_date?: string | null;
  memo?: string | null;
  source_document?: string | null;
}

export interface OpenItem {
  entryId: number;
  /** The bill's line, which a payment names to settle it. */
  lineId?: number;
  date: string;
  dueDate?: string | null;
  description: string | null;
  memo?: string | null;
  reference?: string | null;
  party?: string | null;
  /** Original amount, centavos. */
  amountCents: number;
  /** Unpaid part, centavos, positive in the account's normal direction. */
  openCents: number;
  ageDays: number;
  /** Days past the due date (0 when not yet due or no due date). */
  overdueDays: number;
}

export const AGE_BUCKETS = [
  { label: "0-30 days", max: 30 },
  { label: "31-60 days", max: 60 },
  { label: "61-90 days", max: 90 },
  { label: "Over 90 days", max: Infinity },
];

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/**
 * Open items of an account (or one party's lines), oldest first. A payment that names the bill it
 * settles is applied to that bill; any other reduction is applied to the oldest bills (an advance
 * paid before any bill waits for the next one).
 */
export function openItems(lines: PartyLine[], normal: "debit" | "credit", asOf: string): { items: OpenItem[]; balanceCents: number } {
  const items: OpenItem[] = [];
  const byLine = new Map<number, OpenItem>();
  let unapplied = 0; // reductions not yet matched (e.g. an advance payment)
  const fifo = (amount: number) => {
    let reduce = amount;
    for (const it of items) {
      if (!reduce) break;
      const take = Math.min(it.openCents, reduce);
      it.openCents -= take;
      reduce -= take;
    }
    return reduce;
  };
  for (const l of lines) {
    const up = normal === "credit" ? c(l.credit) - c(l.debit) : c(l.debit) - c(l.credit);
    const target = l.settles_line_id ? byLine.get(Number(l.settles_line_id)) : undefined;
    if (target) {
      // Paying a named bill (up < 0), or undoing such a payment (up > 0).
      const change = Math.max(-target.openCents, Math.min(up, target.amountCents - target.openCents));
      target.openCents += change;
      const rest = up - change;
      if (rest < 0) unapplied += fifo(-rest);
      else if (rest > 0) unapplied = Math.max(0, unapplied - rest);
    } else if (up > 0) {
      let open = up;
      const used = Math.min(open, unapplied);
      open -= used;
      unapplied -= used;
      const due = l.due_date ?? null;
      const it: OpenItem = {
        entryId: l.entry_id,
        lineId: l.line_id,
        date: l.entry_date,
        dueDate: due,
        description: l.description,
        memo: l.memo ?? null,
        reference: l.source_document ?? null,
        party: l.party_name,
        amountCents: up,
        openCents: open,
        ageDays: daysBetween(l.entry_date, asOf),
        overdueDays: due ? Math.max(0, daysBetween(due, asOf)) : 0,
      };
      items.push(it);
      if (l.line_id) byLine.set(Number(l.line_id), it);
    } else if (up < 0) {
      unapplied += fifo(-up);
    }
  }
  const open = items.filter((i) => i.openCents > 0);
  return { items: open, balanceCents: open.reduce((s, i) => s + i.openCents, 0) - unapplied };
}

/** An unpaid bill (payable line) that a payment can tick off. */
export interface OpenBill {
  lineId: number;
  entryId: number;
  book: Book;
  accountCode: string;
  partyId: string | null;
  party: string | null;
  date: string;
  dueDate: string | null;
  description: string | null;
  memo: string | null;
  reference: string | null;
  amountCents: number;
  /** Unpaid, by approved entries. */
  openCents: number;
  /** In payments still waiting for approval. */
  pendingCents: number;
}

/**
 * Unpaid bills on payable accounts (credit balance): per book and account, and per supplier on
 * Accounts Payable, so a payment made without naming a bill settles that supplier's oldest bills.
 */
export function openBills(
  lines: PartyLine[],
  pending: { settles_line_id: number | string; amount: number | string }[],
  asOf: string,
  perParty: (accountCode: string) => boolean,
): OpenBill[] {
  const pendingBy = new Map<number, number>();
  for (const p of pending) pendingBy.set(Number(p.settles_line_id), (pendingBy.get(Number(p.settles_line_id)) ?? 0) + c(p.amount));
  const groups = groupBy(lines, (l) => `${l.book}|${l.account_code}|${perParty(l.account_code) ? (l.party_id ?? l.party_name ?? "") : ""}`);
  const out: OpenBill[] = [];
  for (const ls of groups.values()) {
    for (const it of openItems(ls, "credit", asOf).items) {
      if (!it.lineId) continue;
      const line = ls.find((l) => Number(l.line_id) === it.lineId)!;
      out.push({
        lineId: it.lineId,
        entryId: it.entryId,
        book: line.book,
        accountCode: line.account_code,
        partyId: line.party_id,
        party: line.party_name,
        date: it.date,
        dueDate: it.dueDate ?? null,
        description: it.description,
        memo: it.memo ?? null,
        reference: it.reference ?? null,
        amountCents: it.amountCents,
        openCents: it.openCents,
        pendingCents: pendingBy.get(it.lineId) ?? 0,
      });
    }
  }
  return out.sort((a, b) => (a.dueDate ?? a.date).localeCompare(b.dueDate ?? b.date) || a.lineId - b.lineId);
}

/** A short label for a bill: its memo or reference, else the entry description. */
export function billLabel(b: Pick<OpenBill, "memo" | "reference" | "description">): string {
  return b.memo || b.reference || b.description || "Bill";
}

export function bucketize(items: OpenItem[]): number[] {
  const sums = AGE_BUCKETS.map(() => 0);
  for (const it of items) sums[AGE_BUCKETS.findIndex((b) => it.ageDays <= b.max)] += it.openCents;
  return sums;
}

/** Groups lines by a key (party or account), keeping order. */
export function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return m;
}
