import { CARDS_PAYABLE, REIMBURSEMENTS } from "../shared/accounts";
import { openBills, type OpenBill, type PartyLine } from "../shared/ledger";
import { getAccounts } from "./airtable";
import { dbError } from "./db";
import type { Env } from "./env";
import { getLoans } from "./registers";
import { serviceClient } from "./supabase";

const AP = "2100";
/** Payables with no due date that are still ticked off bill by bill: accrued expenses, payroll, 13th month, gov't contributions, withholding tax, Due to CLD. */
export const OTHER_PAYABLES = ["2120", "2130", "2135", "2141", "2142", "2143", "2155", "2170"];
/** Not ticked here: accrued interest is paid with its installment, owner loans with #36. */
const NOT_BILLS = new Set(["2250", "2260"]);

/**
 * Payable accounts whose bills are ticked off: Accounts Payable, cards, SPayLater,
 * reimbursements, the other payables above, and loans with no schedule in the Loan Tracker
 * (scheduled loans are paid by installment).
 */
export async function payableAccounts(env: Env): Promise<{ codes: string[]; unscheduledLoans: string[] }> {
  const db = serviceClient(env);
  const [accounts, loans] = await Promise.all([getAccounts(env), getLoans(db)]);
  const heads = [...CARDS_PAYABLE, REIMBURSEMENTS];
  const scheduled = new Set(loans.map((l) => l.accountCode));
  const unscheduledLoans = accounts
    .filter((a) => !a.isHeader && a.parentCode === "2200" && a.type === "Liability" && !NOT_BILLS.has(a.code) && !scheduled.has(a.code))
    .map((a) => a.code);
  const codes = [AP, ...accounts.filter((a) => !a.isHeader && heads.includes(a.parentCode ?? "")).map((a) => a.code), ...OTHER_PAYABLES, ...unscheduledLoans];
  return { codes, unscheduledLoans };
}

/** Unpaid bills on payable accounts as of today (approved entries), with payments waiting for approval. */
export async function loadOpenBills(env: Env, asOf: string): Promise<OpenBill[]> {
  const { codes, unscheduledLoans } = await payableAccounts(env);
  const db = serviceClient(env);
  const [lines, pending] = await Promise.all([
    db.rpc("party_lines", { p_accounts: codes, p_to: "9999-12-31" }),
    db.rpc("pending_settlements", { p_accounts: codes }),
  ]);
  dbError(lines.error);
  dbError(pending.error);
  // Bills with a supplier or lender are tracked per party; the rest per account.
  return openBills((lines.data ?? []) as PartyLine[], pending.data ?? [], asOf, (code) => code === AP || unscheduledLoans.includes(code));
}
