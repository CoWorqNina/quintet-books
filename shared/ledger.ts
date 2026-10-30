// Calculations behind the ledger views: trial balance from account totals, balances per party,
// and first-in-first-out aging of open items (supplier bills, clearing balances).

import type { Account, Book } from "./types";
import { toCents } from "./money";

export const RETAINED_EARNINGS = "3300";
/** The eight COGS ingredients compared across suppliers (Rice to LPG). */
export const INGREDIENT_ACCOUNTS = ["5100", "5110", "5120", "5130", "5140", "5150", "5160", "5170"];
export const CLEARING_ACCOUNTS = ["1181", "1182", "1183", "1184", "1185", "1186"];
/** Days a clearing balance may stay unpaid: card 10, Grab and Foodpanda 14. */
export const CLEARING_LIMIT_DAYS: Record<string, number> = { "1181": 10, "1184": 10, "1182": 14, "1183": 14, "1185": 14, "1186": 14 };

export type TrialBalanceMode = "unadjusted" | "adjusted" | "post-closing";
export type BookView = Book | "Combined";

export interface AccountTotal {
  book: Book;
  account_code: string;
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
}

export interface OpenItem {
  entryId: number;
  date: string;
  description: string | null;
  /** Unpaid part, centavos, positive in the account's normal direction. */
  openCents: number;
  ageDays: number;
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
 * Open items by first in, first out: amounts that increase the balance (credits for a
 * liability, debits for an asset) are open items; amounts that reduce it settle the oldest first.
 */
export function openItems(lines: PartyLine[], normal: "debit" | "credit", asOf: string): { items: OpenItem[]; balanceCents: number } {
  const items: OpenItem[] = [];
  let unapplied = 0; // reductions not yet matched (e.g. an advance payment)
  for (const l of lines) {
    const up = normal === "credit" ? c(l.credit) - c(l.debit) : c(l.debit) - c(l.credit);
    if (up > 0) {
      let open = up;
      const used = Math.min(open, unapplied);
      open -= used;
      unapplied -= used;
      if (open) items.push({ entryId: l.entry_id, date: l.entry_date, description: l.description, openCents: open, ageDays: daysBetween(l.entry_date, asOf) });
    } else if (up < 0) {
      let reduce = -up;
      for (const it of items) {
        if (!reduce) break;
        const take = Math.min(it.openCents, reduce);
        it.openCents -= take;
        reduce -= take;
      }
      unapplied += reduce;
    }
  }
  const open = items.filter((i) => i.openCents > 0);
  return { items: open, balanceCents: open.reduce((s, i) => s + i.openCents, 0) - unapplied };
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
