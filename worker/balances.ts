import type { SupabaseClient } from "@supabase/supabase-js";
import type { Book } from "../shared/types";
import { dbError } from "./db";

/** Approved balance of an account in a book across all months, debit-positive, in centavos. */
export async function accountBalanceCents(db: SupabaseClient, book: Book, accountCode: string): Promise<number> {
  const { data, error } = await db.from("account_period_balances").select("debits, credits").eq("book", book).eq("account_code", accountCode);
  dbError(error);
  return (data ?? []).reduce((s, r) => s + Math.round(Number(r.debits) * 100) - Math.round(Number(r.credits) * 100), 0);
}
