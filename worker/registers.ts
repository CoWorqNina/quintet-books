import type { SupabaseClient } from "@supabase/supabase-js";
import type { LoanInfo } from "../shared/templates";
import { ACCRUED_INTEREST } from "../shared/templates/loans";
import { dbError } from "./db";

/** Loans in force with their next unpaid installment and the interest already accrued for them. */
export async function getLoans(db: SupabaseClient): Promise<LoanInfo[]> {
  const [loans, accrued] = await Promise.all([
    db.rpc("open_loans"),
    // Accrued Interest Payable is tracked per loan through the party "loan:<id>".
    db.from("entry_lines").select("party_id, debit, credit, entries!inner(status)").eq("account_code", ACCRUED_INTEREST).eq("entries.status", "Approved").like("party_id", "loan:%"),
  ]);
  dbError(loans.error);
  dbError(accrued.error);
  const accruedByLoan = new Map<string, number>();
  for (const l of accrued.data ?? []) {
    const key = String(l.party_id).slice(5);
    accruedByLoan.set(key, (accruedByLoan.get(key) ?? 0) + Number(l.credit) - Number(l.debit));
  }
  type Row = { id: number; name: string; account_code: string; interest_account: string; book: LoanInfo["book"]; next_id: number | null; next_due: string | null; next_principal: number | null; next_interest: number | null };
  return ((loans.data ?? []) as Row[]).map((r) => ({
    id: r.id,
    name: r.name,
    accountCode: r.account_code,
    interestAccount: r.interest_account,
    book: r.book,
    next: r.next_id
      ? {
          id: r.next_id,
          dueDate: r.next_due ?? "",
          principal: Number(r.next_principal),
          interest: Number(r.next_interest),
          accrued: Math.max(0, Math.round((accruedByLoan.get(String(r.id)) ?? 0) * 100) / 100),
        }
      : null,
  }));
}
