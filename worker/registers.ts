import type { SupabaseClient } from "@supabase/supabase-js";
import type { LoanInfo } from "../shared/templates";

/** Loans from the Loan Tracker with their next unpaid installment (filled in with part 4). */
export async function getLoans(_db: SupabaseClient): Promise<LoanInfo[]> {
  return [];
}
