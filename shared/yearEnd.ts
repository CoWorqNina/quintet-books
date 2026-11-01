// Year-end close (December 31): every income and expense account's balance for the year,
// per book and profit center, is moved to Retained Earnings by a Closing entry, so the next
// year starts with income and expenses at zero.

import { credit, debit, type EntryDraft, type LineDraft } from "./entries";
import type { AccountTotal } from "./ledger";
import { toCents } from "./money";
import type { Account, Book } from "./types";

export const RETAINED_EARNINGS = "3300";

const isIncomeStatement = (code: string, a: Account | undefined) => (a ? a.statement === "Income Statement" : /^[4-9]/.test(code));

/**
 * `totals` are this year's post-closing totals (Closing entries already approved included), so
 * the entry only closes what is still open; once closed, nothing is left to propose.
 */
export function closingEntry(year: number, book: Book, totals: AccountTotal[], accounts: Map<string, Account>): EntryDraft | null {
  const lines: LineDraft[] = [];
  let netCents = 0; // debit-positive: a net loss is a debit balance
  const sorted = totals
    .filter((t) => t.book === book && isIncomeStatement(t.account_code, accounts.get(t.account_code)))
    .sort((a, b) => a.account_code.localeCompare(b.account_code) || String(a.profit_center).localeCompare(String(b.profit_center)));
  for (const t of sorted) {
    const balance = toCents(Number(t.year_debit)) - toCents(Number(t.year_credit));
    if (!balance) continue;
    netCents += balance;
    const extras = { profit_center: t.profit_center ?? null };
    lines.push(balance > 0 ? credit(t.account_code, balance, "close.account", extras) : debit(t.account_code, -balance, "close.account", extras));
  }
  if (!lines.length) return null;
  lines.push(netCents > 0 ? debit(RETAINED_EARNINGS, netCents, "close.retained") : credit(RETAINED_EARNINGS, -netCents, "close.retained"));
  return {
    kind: "Closing",
    transaction_type: null,
    book,
    profit_center: null,
    entry_date: `${year}-12-31`,
    description: `Year-end closing ${year}: income and expenses to Retained Earnings (${netCents > 0 ? "net loss" : "net income"})`,
    reason: `Year-end close of fiscal year ${year}`,
    lines,
  };
}
