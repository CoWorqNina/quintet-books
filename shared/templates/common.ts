// Building blocks for the Section 7 templates. A template declares the fields the encoder fills
// in and builds the entries from them; the encoder never picks debits or credits.

import { accountMatches, type AccountFilter, needsQuantity, profitCenterAllowed } from "../accounts";
import { type Attachment, type EntryDraft, finishEntry, type LineDraft, debit } from "../entries";
import { formatPeso, toCents } from "../money";
import type { Account, Book, Party, ProfitCenter, Role } from "../types";

export type FieldType =
  | "date"
  | "money"
  | "number"
  | "text"
  | "select"
  | "checkbox"
  | "attachment"
  | "account" // pick list from the Chart of Accounts, narrowed by `filter`
  | "party" // supplier, employee, owner or lender from Airtable Parties
  | "product" // Commissary product
  | "loan" // loan from the Loan Tracker
  | "profitCenter" // GGC / The Nest (per line)
  | "rows"; // repeating lines with `columns`

export interface Field {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: { value: string; label: string }[];
  filter?: AccountFilter;
  partyType?: Party["type"];
  columns?: Field[];
  help?: string;
  /** Show only when another field has one of these values. */
  showIf?: { field: string; values: string[] };
  /** Store book only (hidden for Commissary entries). */
  storeOnly?: boolean;
  /** Book whose accounts an account field lists, when it differs from the entry's (two-book templates). */
  book?: Book;
}

export type Scalar = string | number | boolean | null | undefined;
export type Row = Record<string, Scalar | Attachment>;
export type Values = Record<string, Scalar | Attachment | Row[]>;

export interface Product {
  id: string;
  name: string;
  unit: string;
  cogsAccount: string;
  active: boolean;
}

export interface LoanInfo {
  id: number;
  name: string;
  accountCode: string;
  interestAccount: string;
  book: Book;
  /** Next unpaid installment from the schedule, with interest already accrued for it. */
  next: { id: number; dueDate: string; principal: number; interest: number; accrued: number } | null;
}

export interface TemplateContext {
  book: Book;
  profitCenter: "GGC" | "The Nest";
  accounts: Map<string, Account>;
  parties: Map<string, Party>;
  products?: Map<string, Product>;
  loans?: Map<string, LoanInfo>;
  /** Approved balance of Due to Commissary (credit balance, centavos), for the monthly settlement. */
  dueToCommissaryCents?: number;
}

/** A schedule record created together with an entry (asset, prepaid spread, loan). */
export interface RegisterDraft {
  type: "asset" | "spread" | "loan" | "loan_payment";
  data: Record<string, unknown>;
}

export interface BuildResult {
  entries: EntryDraft[];
  errors: string[];
  register?: RegisterDraft;
}

export interface Template {
  number: number;
  name: string;
  group: string;
  roles: Role[];
  /** Books the entry can be made in; two-book templates post to both at once. */
  books: Book[];
  twoBook?: boolean;
  /** Routine entries may be approved in the daily batch; the rest one by one. */
  batchApproval: boolean;
  fields: Field[];
  build(values: Values, ctx: TemplateContext): BuildResult;
}

export const ENCODERS: Role[] = ["Owner", "Accountant", "Supervisor", "Staff"];
export const OWNERS_ACCOUNTANT: Role[] = ["Owner", "Accountant"];
export const ALL_BOOKS: Book[] = ["Store", "Commissary"];
export const STORE: Book[] = ["Store"];

export const str = (v: unknown) => (typeof v === "string" ? v.trim() : v == null || typeof v === "object" ? "" : String(v));
export const att = (v: unknown) => (v && typeof v === "object" && "path" in (v as object) ? (v as Attachment) : null);
export const cents = (v: unknown) => (typeof v === "number" || typeof v === "string" ? toCents(v) : 0);
export const rowsOf = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);

/** The profit center a line is tagged with: Commissary lines are always GGC. */
export function linePc(ctx: TemplateContext, v?: unknown): ProfitCenter {
  if (ctx.book === "Commissary") return "GGC";
  const pc = str(v);
  return pc === "GGC" || pc === "The Nest" || pc === "Shared" ? pc : ctx.profitCenter;
}

function missing(f: Field, v: unknown): boolean {
  if (f.type === "attachment") return !att(v);
  if (f.type === "money") return !(cents(v) > 0);
  if (f.type === "rows") return rowsOf(v).length === 0;
  if (f.type === "checkbox") return !v;
  return !str(v);
}

function visible(f: Field, values: Values | Row, ctx: TemplateContext) {
  if (f.storeOnly && ctx.book !== "Store") return false;
  return !f.showIf || f.showIf.values.includes(str(values[f.showIf.field]));
}

export function visibleFields(fields: Field[], values: Values | Row, ctx: TemplateContext): Field[] {
  return fields.filter((f) => visible(f, values, ctx));
}

export function requireFields(fields: Field[], values: Values, ctx: TemplateContext, errors: string[]) {
  for (const f of visibleFields(fields, values, ctx)) {
    if (f.required && missing(f, values[f.name])) errors.push(`${f.label} is required.`);
    if (f.type === "rows" && f.columns) {
      rowsOf(values[f.name]).forEach((row, i) => {
        for (const c of visibleFields(f.columns!, row, ctx)) {
          if (c.required && missing(c, row[c.name])) errors.push(`Line ${i + 1}: ${c.label} is required.`);
        }
      });
    }
  }
}

export function checkAccount(code: string, filter: AccountFilter, label: string, ctx: TemplateContext, errors: string[]) {
  // (ctx may be a copy with another book for two-book templates)
  if (!code) return undefined;
  const a = ctx.accounts.get(code);
  const problem = a ? `${a.code} ${a.name} can't be used here` : "choose an account";
  if (!accountMatches(filter, a, ctx)) {
    errors.push(`${label}: ${problem}.`);
    return undefined;
  }
  return a;
}

export function checkParty(id: string, type: Party["type"], label: string, ctx: TemplateContext, errors: string[]) {
  if (!id) return undefined;
  const p = ctx.parties.get(id);
  if (!p || p.type !== type || !p.active) {
    errors.push(`${label}: choose an active ${type.toLowerCase()}.`);
    return undefined;
  }
  if (!p.approved) {
    errors.push(`${label}: ${p.name} is waiting for owner approval.`);
    return undefined;
  }
  return p;
}

export function partyExtras(p: Party | undefined) {
  return { party_id: p?.id ?? null, party_name: p?.name ?? null };
}

/** Standard columns for "expense line" rows (purchases, petty cash, Commissary costs). */
export const EXPENSE_COLUMNS: Field[] = [
  { name: "account", label: "Expense line", type: "account", filter: "expense", required: true },
  { name: "description", label: "Item", type: "text" },
  { name: "quantity", label: "Qty", type: "number", help: "Ingredients" },
  { name: "unit", label: "Unit", type: "text", help: "Ingredients" },
  { name: "unitPrice", label: "Unit price", type: "money", help: "Ingredients" },
  { name: "amount", label: "Amount", type: "money", required: true },
  { name: "profitCenter", label: "Profit center", type: "profitCenter", storeOnly: true },
];

/**
 * Debit lines for expense rows. Each row is one account and profit center, so shared costs
 * (utilities, rent) are split by adding one row per profit center.
 */
export function expenseLines(rows: Row[], ctx: TemplateContext, errors: string[], templateLine: string) {
  // ctx.book decides which book's expense accounts are allowed
  const lines: LineDraft[] = [];
  let totalCents = 0;
  rows.forEach((row, i) => {
    const n = `Line ${i + 1}`;
    const account = checkAccount(str(row.account), "expense", n, ctx, errors);
    const amount = cents(row.amount);
    const pc = linePc(ctx, row.profitCenter);
    if (account && !profitCenterAllowed(account, pc)) errors.push(`${n}: ${account.code} ${account.name} can't be tagged ${pc}.`);
    const qty = account && needsQuantity(account);
    if (qty) {
      if (!(Number(row.quantity) > 0) || !str(row.unit) || !(cents(row.unitPrice) > 0)) {
        errors.push(`${n}: ingredients need quantity, unit and unit price.`);
      }
    }
    totalCents += amount;
    lines.push(
      debit(str(row.account), amount, templateLine, {
        profit_center: pc,
        quantity: qty ? Number(row.quantity) : null,
        unit: qty ? str(row.unit) : null,
        unit_price: qty ? cents(row.unitPrice) / 100 : null,
        memo: str(row.description) || null,
      }),
    );
  });
  return { lines, totalCents };
}

/** Wraps lines into a template entry in the context's book; drops zero lines. */
export function makeEntry(
  ctx: TemplateContext,
  values: Values,
  number: number,
  description: string,
  lines: LineDraft[],
  extra: Partial<Pick<EntryDraft, "source_document" | "unsupported" | "attachments" | "book" | "profit_center">> = {},
): EntryDraft | null {
  const book = extra.book ?? ctx.book;
  return finishEntry({
    kind: "Template",
    transaction_type: number,
    book,
    profit_center: extra.profit_center ?? (book === "Commissary" ? "GGC" : ctx.profitCenter),
    entry_date: str(values.date),
    description,
    source_document: extra.source_document ?? null,
    unsupported: extra.unsupported ?? false,
    attachments: extra.attachments ?? [],
    lines,
  });
}

export function attachmentsOf(...values: unknown[]): Attachment[] {
  return values.map(att).filter((a): a is Attachment => a !== null);
}

export function result(errors: string[], ...entries: (EntryDraft | null)[]): BuildResult {
  return { errors, entries: entries.filter((e): e is EntryDraft => e !== null) };
}

export { formatPeso };

export const dateField: Field = { name: "date", label: "Date", type: "date", required: true };
