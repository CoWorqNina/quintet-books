import type { SupabaseClient } from "@supabase/supabase-js";
import type { LoanInfo } from "../shared/templates";
import { dbError } from "./db";

/** Loans in force with their next unpaid installment and whether its interest is already recorded. */
export async function getLoans(db: SupabaseClient): Promise<LoanInfo[]> {
  const { data, error } = await db.rpc("open_loans");
  dbError(error);
  type Row = { id: number; name: string; account_code: string; interest_account: string; book: LoanInfo["book"]; next_id: number | null; next_seq: number | null; next_due: string | null; next_principal: number | null; next_interest: number | null; next_interest_recorded: boolean | null };
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    name: r.name,
    accountCode: r.account_code,
    interestAccount: r.interest_account,
    book: r.book,
    next: r.next_id
      ? {
          id: r.next_id,
          seq: r.next_seq ?? 0,
          dueDate: r.next_due ?? "",
          principal: Number(r.next_principal),
          interest: Number(r.next_interest),
          interestRecorded: !!r.next_interest_recorded,
        }
      : null,
  }));
}
