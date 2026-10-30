import { fromCents, sumCents } from "./money";
import type { Book, ProfitCenter } from "./types";

export interface Attachment {
  path: string; // storage path in the private "attachments" bucket
  name: string;
  type: string;
  size: number;
}

/** One debit or credit, in centavos while being built. */
export interface LineDraft {
  account_code: string;
  debitCents: number;
  creditCents: number;
  profit_center?: ProfitCenter | null;
  party_id?: string | null;
  party_name?: string | null;
  quantity?: number | null;
  unit?: string | null;
  unit_price?: number | null;
  memo?: string | null;
  template_line: string;
}

export interface EntryDraft {
  kind: "Template" | "Special" | "Adjusting" | "Opening";
  transaction_type: number | null;
  book: Book;
  profit_center: ProfitCenter | null;
  entry_date: string;
  description: string;
  source_document?: string | null;
  unsupported?: boolean;
  attachments?: Attachment[];
  reason?: string | null;
  classifies_entry_id?: number | null;
  lines: LineDraft[];
}

type LineExtras = Omit<LineDraft, "account_code" | "debitCents" | "creditCents" | "template_line">;

export function debit(account: string, cents: number, templateLine: string, extras: LineExtras = {}): LineDraft {
  return { account_code: account, debitCents: cents, creditCents: 0, template_line: templateLine, ...extras };
}

export function credit(account: string, cents: number, templateLine: string, extras: LineExtras = {}): LineDraft {
  return { account_code: account, debitCents: 0, creditCents: cents, template_line: templateLine, ...extras };
}

/** A debit when positive, a credit when negative (e.g. a petty cash top-up that can go either way). */
export function signed(account: string, cents: number, templateLine: string, extras: LineExtras = {}): LineDraft {
  return cents >= 0 ? debit(account, cents, templateLine, extras) : credit(account, -cents, templateLine, extras);
}

/** Drops zero lines; returns null when nothing is left to post. */
export function finishEntry(entry: EntryDraft): EntryDraft | null {
  const lines = entry.lines.filter((l) => l.debitCents !== 0 || l.creditCents !== 0);
  return lines.length ? { ...entry, lines } : null;
}

export function entryTotals(entry: EntryDraft) {
  return {
    debitCents: sumCents(entry.lines.map((l) => l.debitCents)),
    creditCents: sumCents(entry.lines.map((l) => l.creditCents)),
  };
}

export function isBalanced(entry: EntryDraft): boolean {
  const t = entryTotals(entry);
  return t.debitCents === t.creditCents && t.debitCents > 0;
}

/** The JSON shape the database's create_entries / create_daily_report functions expect. */
export function toDbEntry(entry: EntryDraft) {
  const { lines, ...header } = entry;
  return {
    ...header,
    lines: lines.map(({ debitCents, creditCents, ...rest }) => ({
      ...rest,
      debit: fromCents(debitCents),
      credit: fromCents(creditCents),
    })),
  };
}
