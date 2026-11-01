import type { SupabaseClient } from "@supabase/supabase-js";
import { type AccountTotal, monthEnd, yearStart } from "../shared/ledger";
import {
  amortization,
  type AssetRecord,
  type Booked,
  bookedKey,
  depreciation,
  type Generated,
  type GeneratedKind,
  interestAccrual,
  type LoanRecord,
  type SpreadRecord,
  thirteenthMonth,
} from "../shared/monthEnd";
import { toCents } from "../shared/money";
import type { Book, ProfitCenter } from "../shared/types";
import { dbError } from "./db";

export interface Registers {
  assets: (AssetRecord & { cost: number })[];
  spreads: SpreadRecord[];
  loans: (Omit<LoanRecord, "installments"> & { account_code: string; principal: number; installments: { seq: number; due_date: string; principal: number; interest: number; paid_entry_id: number | null }[] | null })[];
}

export async function loadRegisters(db: SupabaseClient): Promise<Registers> {
  const { data, error } = await db.rpc("registers_overview");
  dbError(error);
  return data as Registers;
}

export async function loadBooked(db: SupabaseClient, period: string): Promise<Booked> {
  const booked: Booked = new Map();
  const results = await Promise.all(["asset:", "spread:", "loan:"].map((p) => db.rpc("booked_by_party", { p_prefix: p, p_to: monthEnd(period) })));
  for (const { data, error } of results) {
    dbError(error);
    for (const r of (data ?? []) as { party_id: string; account_code: string; net: number }[]) {
      const k = bookedKey(r.party_id, r.account_code);
      booked.set(k, (booked.get(k) ?? 0) + toCents(Number(r.net)));
    }
  }
  return booked;
}

export interface ExistingGenerated {
  id: number;
  book: Book;
  generated: GeneratedKind;
  status: string;
}

export async function existingGenerated(db: SupabaseClient, period: string): Promise<ExistingGenerated[]> {
  const { data, error } = await db.rpc("generated_entries", { p_period: period });
  dbError(error);
  return (data ?? []) as ExistingGenerated[];
}

/** What the app would generate for the month (inventory comes from the counts). */
export async function proposals(db: SupabaseClient, period: string): Promise<Generated[]> {
  const [registers, booked, gross] = await Promise.all([
    loadRegisters(db),
    loadBooked(db, period),
    db.rpc("payroll_gross", { p_from: `${period}-01`, p_to: monthEnd(period) }),
  ]);
  dbError(gross.error);
  return [
    ...depreciation(period, registers.assets ?? [], booked),
    ...amortization(period, registers.spreads ?? [], booked),
    ...interestAccrual(period, registers.loans ?? [], booked),
    ...thirteenthMonth(period, (gross.data ?? []) as { book: Book; profit_center: ProfitCenter | null; amount: number }[]),
  ];
}

/** Approved trial balance totals as of the month-end. */
export async function totalsAt(db: SupabaseClient, period: string): Promise<AccountTotal[]> {
  const asOf = monthEnd(period);
  const { data, error } = await db.rpc("account_totals", { p_to: asOf, p_year_start: yearStart(asOf), p_mode: "adjusted" });
  dbError(error);
  return (data ?? []) as AccountTotal[];
}

/** Balance of an account (debit-positive, centavos) from all-time totals, per book (and profit center). */
export function balanceOf(totals: AccountTotal[], code: string, book?: Book, pc?: (p: ProfitCenter | null) => boolean): number {
  return totals
    .filter((t) => t.account_code === code && (!book || t.book === book) && (!pc || pc(t.profit_center ?? null)))
    .reduce((s, t) => s + toCents(Number(t.prior_debit)) - toCents(Number(t.prior_credit)) + toCents(Number(t.year_debit)) - toCents(Number(t.year_credit)), 0);
}
