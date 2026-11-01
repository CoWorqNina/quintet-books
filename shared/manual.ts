// Entries typed line by line: Special and Adjusting entries (Owner/Accountant, with a reason),
// opening balances (#43) and the classification of "For Classification" (#39) movements.

import { ACCOUNTS, bookAllowed } from "./accounts";
import { GO_LIVE_DATE } from "./config";
import { type Attachment, credit, debit, type EntryDraft, isBalanced, type LineDraft } from "./entries";
import { formatPeso, sumCents, toCents } from "./money";
import type { Account, Book, Party, ProfitCenter } from "./types";

export const OPENING_DATE = "2026-10-31";
/** Accrued interest is tracked per loan, kept apart from the loan's principal. */
export const ACCRUED_INTEREST = "2250";

/** Loans as parties ("loan:<id>"), so Accrued Interest Payable lines can be tagged to their loan. */
export function loanParties(loans: { id: number; name: string }[]): Party[] {
  return loans.map((l) => ({
    id: `loan:${l.id}`, name: l.name, type: "Lender", books: ["Store", "Commissary"], profitCenter: null, active: true, approved: true,
    approvalStatus: null, contactDetails: null, paymentTerms: null, itemsSupplied: null, addedBy: null,
  }));
}
export const OPENING_TEMPLATE = 43;

export interface ManualLine {
  account: string;
  debit?: number | string | null;
  credit?: number | string | null;
  profitCenter?: string | null;
  party?: string | null;
  memo?: string | null;
}

export interface ManualInput {
  kind: "Special" | "Adjusting" | "Opening";
  book: Book;
  date: string;
  description: string;
  reason: string;
  lines: ManualLine[];
  attachments?: Attachment[];
}

const money = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : toCents(Number(v)));

/**
 * Profit center for a line: income statement lines in the Store book need GGC, The Nest or Shared
 * (as the account's rule allows); the Commissary book is all GGC; balance sheet lines carry none.
 */
export function lineProfitCenter(a: Account, book: Book, chosen: string | null | undefined, errors: string[]): ProfitCenter | null {
  if (a.statement !== "Income Statement") return null;
  if (book === "Commissary") return "GGC";
  const rule = a.profitCenterRule ?? "";
  if (rule === "GGC" || rule === "The Nest" || rule === "Shared") return rule;
  const pc = chosen ?? "";
  const allowed = rule.startsWith("GGC or The Nest") ? ["GGC", "The Nest"] : ["GGC", "The Nest", "Shared"];
  if (!allowed.includes(pc)) {
    errors.push(`${a.code} ${a.name}: choose ${allowed.join(" or ")}.`);
    return null;
  }
  return pc as ProfitCenter;
}

export function buildManualEntry(
  input: ManualInput,
  accounts: Map<string, Account>,
  parties: Map<string, Party>,
): { entry: EntryDraft | null; errors: string[] } {
  const errors: string[] = [];
  const opening = input.kind === "Opening";
  if (!input.reason?.trim()) errors.push("Give the reason for this entry.");
  if (!input.description?.trim()) errors.push("Describe the entry.");
  if (opening && input.date !== OPENING_DATE) errors.push(`Opening balances are dated ${OPENING_DATE}.`);
  if (!opening && input.date < GO_LIVE_DATE) errors.push("Entries start on November 1, 2026.");
  const lines: LineDraft[] = [];
  input.lines.forEach((l, i) => {
    const d = money(l.debit);
    const c = money(l.credit);
    if (!l.account && !d && !c) return;
    const a = accounts.get(l.account);
    const label = `Line ${i + 1}`;
    if (!a) return void errors.push(`${label}: choose an account.`);
    if (a.isHeader || !a.active) return void errors.push(`${label}: ${a.code} ${a.name} can't be posted to.`);
    if (!bookAllowed(a, input.book)) return void errors.push(`${label}: ${a.code} isn't used in the ${input.book} book.`);
    if (opening && a.statement !== "Balance Sheet") return void errors.push(`${label}: opening balances are for balance sheet accounts only.`);
    if (d < 0 || c < 0) return void errors.push(`${label}: amounts can't be negative.`);
    if (d && c) return void errors.push(`${label}: enter a debit or a credit, not both.`);
    if (!d && !c) return void errors.push(`${label}: enter an amount.`);
    const party = l.party ? parties.get(l.party) : undefined;
    if (l.party && !party) errors.push(`${label}: unknown party.`);
    if (a.code === ACCRUED_INTEREST && !party?.id.startsWith("loan:")) errors.push(`${label}: choose the loan this interest belongs to.`);
    const extras = {
      profit_center: lineProfitCenter(a, input.book, l.profitCenter, errors),
      party_id: party?.id ?? null,
      party_name: party?.name ?? null,
      memo: l.memo?.trim() || null,
    };
    lines.push(d ? debit(a.code, d, "manual", extras) : credit(a.code, c, "manual", extras));
  });
  if (lines.length < 2) errors.push("An entry needs at least two lines.");
  const entry: EntryDraft = {
    kind: input.kind,
    transaction_type: opening ? OPENING_TEMPLATE : null,
    book: input.book,
    profit_center: null,
    entry_date: input.date,
    description: input.description?.trim() ?? "",
    reason: input.reason?.trim() ?? "",
    attachments: input.attachments ?? [],
    lines,
  };
  if (lines.length >= 2 && !isBalanced(entry)) {
    const dr = sumCents(lines.map((l) => l.debitCents));
    const cr = sumCents(lines.map((l) => l.creditCents));
    errors.push(`Debits ${formatPeso(dr)} and credits ${formatPeso(cr)} must be equal.`);
  }
  return { entry: errors.length ? null : entry, errors };
}

export interface ClassifyLine {
  account: string;
  amount: number | string;
  profitCenter?: string | null;
  memo?: string | null;
}

/**
 * Settles a "For Classification" (#39) movement: moves its amount out of the suspense account
 * into the accounts it turned out to be, as a Special entry linked to the original.
 */
export function buildClassification(
  original: { id: number; book: Book; date: string; amountCents: number; moneyOut: boolean; description: string },
  input: { date: string; reason: string; lines: ClassifyLine[] },
  accounts: Map<string, Account>,
): { entry: EntryDraft | null; errors: string[] } {
  const errors: string[] = [];
  if (!input.reason?.trim()) errors.push("Explain what the movement turned out to be.");
  const lines: LineDraft[] = [];
  input.lines.forEach((l, i) => {
    const a = accounts.get(l.account);
    const amount = money(l.amount);
    if (!a || a.isHeader || !a.active || !bookAllowed(a, original.book)) return void errors.push(`Line ${i + 1}: choose an account.`);
    if (a.code === ACCOUNTS.suspense) return void errors.push(`Line ${i + 1}: choose the real account, not the suspense account.`);
    if (amount <= 0) return void errors.push(`Line ${i + 1}: enter an amount.`);
    const extras = { profit_center: lineProfitCenter(a, original.book, l.profitCenter, errors), memo: l.memo?.trim() || null };
    lines.push(original.moneyOut ? debit(a.code, amount, "classify.account", extras) : credit(a.code, amount, "classify.account", extras));
  });
  const total = sumCents(lines.map((l) => l.debitCents + l.creditCents));
  if (lines.length && total !== original.amountCents) {
    errors.push(`The lines total ${formatPeso(total)}; they must add up to ${formatPeso(original.amountCents)}.`);
  }
  lines.push(
    original.moneyOut
      ? credit(ACCOUNTS.suspense, original.amountCents, "classify.suspense")
      : debit(ACCOUNTS.suspense, original.amountCents, "classify.suspense"),
  );
  const entry: EntryDraft = {
    kind: "Special",
    transaction_type: null,
    book: original.book,
    profit_center: null,
    entry_date: input.date,
    description: `Classification of entry ${original.id}: ${original.description}`,
    reason: input.reason?.trim() ?? "",
    classifies_entry_id: original.id,
    lines,
  };
  return { entry: errors.length ? null : entry, errors };
}
