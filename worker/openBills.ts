import { CARDS_PAYABLE, REIMBURSEMENTS } from "../shared/accounts";
import { openBills, type OpenBill, type PartyLine } from "../shared/ledger";
import { getAccounts } from "./airtable";
import { dbError } from "./db";
import type { Env } from "./env";
import { serviceClient } from "./supabase";

const AP = "2100";

/** Payable accounts whose bills are ticked off: Accounts Payable, cards, SPayLater, reimbursements. */
export async function payableAccounts(env: Env): Promise<string[]> {
  const accounts = await getAccounts(env);
  const heads = [...CARDS_PAYABLE, REIMBURSEMENTS];
  return [AP, ...accounts.filter((a) => !a.isHeader && heads.includes(a.parentCode ?? "")).map((a) => a.code)];
}

/** Unpaid bills on payable accounts as of today (approved entries), with payments waiting for approval. */
export async function loadOpenBills(env: Env, asOf: string): Promise<OpenBill[]> {
  const codes = await payableAccounts(env);
  const db = serviceClient(env);
  const [lines, pending] = await Promise.all([
    db.rpc("party_lines", { p_accounts: codes, p_to: "9999-12-31" }),
    db.rpc("pending_settlements", { p_accounts: codes }),
  ]);
  dbError(lines.error);
  dbError(pending.error);
  return openBills((lines.data ?? []) as PartyLine[], pending.data ?? [], asOf, (code) => code === AP);
}
