import type { SupabaseClient } from "@supabase/supabase-js";
import { getTemplate, TEMPLATE_NAMES } from "../shared/templates";
import type { Account, JournalEntry } from "../shared/types";
import { dbError } from "./db";

export const ENTRY_SELECT =
  "id, kind, transaction_type, book, profit_center, entry_date, status, description, source_document, reason, " +
  "unsupported, attachments, daily_report_id, reverses_entry_id, classifies_entry_id, created_by, created_at, approved_by, approved_at, rejection_reason, " +
  "entry_lines(line_no, account_code, profit_center, debit, credit, party_name, quantity, unit, unit_price, memo)";

let userNames: { at: number; names: Map<string, string> } | undefined;

export async function getUserNames(db: SupabaseClient): Promise<Map<string, string>> {
  if (userNames && Date.now() - userNames.at < 60_000) return userNames.names;
  const { data, error } = await db.from("app_users").select("id, full_name");
  dbError(error);
  userNames = { at: Date.now(), names: new Map((data ?? []).map((u) => [u.id, u.full_name])) };
  return userNames.names;
}

/** Routine template entries (with receipts) may be approved in the daily batch. */
export function canBatchApprove(row: { kind: string; transaction_type: number | null; unsupported: boolean }): boolean {
  if (row.kind !== "Template" || row.unsupported) return false;
  if (row.transaction_type === null) return false;
  const t = getTemplate(row.transaction_type);
  return t ? t.batchApproval : row.transaction_type in TEMPLATE_NAMES;
}

/** Templates whose entries create a register record are reversed and re-entered, not corrected in place. */
export const REGISTER_TEMPLATES = new Set([29, 31, 33, 34]);

/** An approved template entry outside a daily report can be corrected from its saved form. */
export function isCorrectable(row: { kind: string; transaction_type: number | null; daily_report_id: number | null }): boolean {
  return row.kind === "Template" && !row.daily_report_id && row.transaction_type !== null && !!getTemplate(row.transaction_type) && !REGISTER_TEMPLATES.has(row.transaction_type);
}

/** Fills in which live entry reverses each of these entries. */
export async function withReversals(db: SupabaseClient, list: JournalEntry[]): Promise<JournalEntry[]> {
  const ids = list.filter((e) => e.status === "Approved").map((e) => e.id);
  if (!ids.length) return list;
  const { data, error } = await db.from("entries").select("id, reverses_entry_id").in("reverses_entry_id", ids).not("status", "in", "(Rejected,Cancelled)");
  dbError(error);
  const by = new Map((data ?? []).map((r) => [r.reverses_entry_id as number, r.id as number]));
  return list.map((e) => ({ ...e, reversedBy: by.get(e.id) ?? null }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toJournalEntry(row: any, accounts: Map<string, Account>, names: Map<string, string>): JournalEntry {
  const lines = [...(row.entry_lines ?? [])].sort((a, b) => a.line_no - b.line_no);
  return {
    id: row.id,
    kind: row.kind,
    transactionType: row.transaction_type,
    templateName:
      row.kind === "Template" ? (TEMPLATE_NAMES[row.transaction_type] ?? `Template #${row.transaction_type}`) : row.kind,
    book: row.book,
    profitCenter: row.profit_center,
    entryDate: row.entry_date,
    status: row.status,
    description: row.description,
    sourceDocument: row.source_document,
    reason: row.reason,
    unsupported: row.unsupported,
    attachments: row.attachments ?? [],
    dailyReportId: row.daily_report_id,
    reversesEntryId: row.reverses_entry_id ?? null,
    classifiesEntryId: row.classifies_entry_id ?? null,
    reversedBy: null,
    correctable: isCorrectable(row),
    createdBy: names.get(row.created_by) ?? "Unknown",
    createdAt: row.created_at,
    approvedBy: row.approved_by ? (names.get(row.approved_by) ?? "Unknown") : null,
    approvedAt: row.approved_at,
    rejectionReason: row.rejection_reason,
    totalDebit: lines.reduce((s, l) => s + Number(l.debit), 0),
    canBatchApprove: canBatchApprove(row),
    lines: lines.map((l) => ({
      lineNo: l.line_no,
      accountCode: l.account_code,
      accountName: accounts.get(l.account_code)?.name ?? "",
      profitCenter: l.profit_center,
      debit: Number(l.debit),
      credit: Number(l.credit),
      partyName: l.party_name,
      quantity: l.quantity === null ? null : Number(l.quantity),
      unit: l.unit,
      unitPrice: l.unit_price === null ? null : Number(l.unit_price),
      memo: l.memo,
    })),
  };
}
