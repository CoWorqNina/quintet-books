import type { SupabaseClient } from "@supabase/supabase-js";
import { getTemplate, TEMPLATE_NAMES } from "../shared/templates";
import type { Account, JournalEntry } from "../shared/types";
import { dbError } from "./db";

export const ENTRY_SELECT =
  "id, kind, transaction_type, book, profit_center, entry_date, status, description, source_document, reason, " +
  "unsupported, attachments, daily_report_id, created_by, created_at, approved_by, approved_at, rejection_reason, " +
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
