import { Hono } from "hono";
import { REIMBURSEMENTS } from "../../shared/accounts";
import { billLabel } from "../../shared/ledger";
import type { PayableItem, PayableKind, PayablesSummary } from "../../shared/payables";
import type { Account } from "../../shared/types";
import { seesEverything, todayManila } from "../access";
import { getAccounts } from "../airtable";
import { dbError, forbidden } from "../db";
import type { AppContext } from "../env";
import { loadOpenBills } from "../openBills";
import { serviceClient } from "../supabase";

/** Other payables shown with no due date (balance only). */
const OTHER_PAYABLES = ["2120", "2130", "2135", "2141", "2142", "2143", "2155", "2170"];
const NOT_LOANS = new Set(["2250", "2260"]); // accrued interest is paid with the installment; owner loans aren't planned

export const payables = new Hono<AppContext>();

type Installment = { id: number; seq: number; due_date: string; principal: number; interest: number; paid: boolean };
type LoanReg = { id: number; name: string; lender_name: string; account_code: string; book: "Store" | "Commissary"; in_force: boolean; installments: Installment[] | null };

payables.get("/", async (c) => {
  if (!seesEverything(c.get("user"))) forbidden();
  const today = todayManila();
  const db = serviceClient(c.env);
  const accounts = new Map((await getAccounts(c.env)).map((a) => [a.code, a]));
  const name = (code: string) => accounts.get(code)?.name ?? code;
  const kindOf = (a: Account | undefined): PayableKind =>
    a?.code === "2100" ? "supplier" : a?.parentCode === "2190" ? "card" : a?.parentCode === "2160" ? "spaylater" : a?.parentCode === REIMBURSEMENTS ? "reimbursement" : "other";

  const cashCodes = [...accounts.values()].filter((a) => a.isCashAccount && !a.isHeader).map((a) => a.code);
  const loanCodes = [...accounts.values()].filter((a) => a.parentCode === "2200" && a.type === "Liability" && !NOT_LOANS.has(a.code)).map((a) => a.code);
  const [bills, regs, balances] = await Promise.all([
    loadOpenBills(c.env, today),
    db.rpc("registers_overview"),
    db.from("account_period_balances").select("book, account_code, debits, credits").in("account_code", [...cashCodes, ...loanCodes, ...OTHER_PAYABLES]),
  ]);
  dbError(regs.error);
  dbError(balances.error);
  const bal = new Map<string, number>(); // book|code -> credit-positive centavos
  for (const r of balances.data ?? []) {
    const k = `${r.book}|${r.account_code}`;
    bal.set(k, (bal.get(k) ?? 0) + Math.round(Number(r.credits) * 100) - Math.round(Number(r.debits) * 100));
  }
  const items: PayableItem[] = [];

  for (const b of bills) {
    const kind = kindOf(accounts.get(b.accountCode));
    const isCardLike = kind === "card" || kind === "spaylater" || kind === "reimbursement";
    items.push({
      key: `bill:${b.lineId}`,
      kind,
      book: b.book,
      accountCode: b.accountCode,
      accountName: name(b.accountCode),
      payee: kind === "supplier" ? (b.party ?? "Supplier") : name(b.accountCode),
      label: billLabel(b),
      date: b.date,
      dueDate: b.dueDate,
      openCents: b.openCents,
      pendingCents: b.pendingCents,
      pay:
        kind === "supplier" && b.partyId
          ? { template: 14, values: { supplier: b.partyId, bill: String(b.lineId) } }
          : isCardLike
            ? { template: 18, values: { person: b.accountCode, bill: String(b.lineId) } }
            : undefined,
    });
  }

  // Scheduled loans: each unpaid installment. Their accounts are left out of the unscheduled list.
  const scheduled = new Set<string>();
  for (const l of ((regs.data as { loans?: LoanReg[] })?.loans ?? []).filter((x) => x.in_force)) {
    scheduled.add(`${l.book}|${l.account_code}`);
    const rows = l.installments ?? [];
    for (const i of rows.filter((r) => !r.paid)) {
      items.push({
        key: `inst:${i.id}`,
        kind: "loan",
        book: l.book,
        accountCode: l.account_code,
        accountName: name(l.account_code),
        payee: l.lender_name,
        label: `${l.name} – installment ${i.seq} of ${rows.length}`,
        date: null,
        dueDate: i.due_date,
        openCents: Math.round((Number(i.principal) + Number(i.interest)) * 100),
        pendingCents: 0,
        pay: { template: 34, values: { loan: String(l.id) } },
      });
    }
  }
  // Loans with no schedule (on demand) and other payables: balance only.
  for (const [k, cents] of bal) {
    const [book, code] = k.split("|") as ["Store" | "Commissary", string];
    if (cents <= 0 || cashCodes.includes(code) || scheduled.has(k)) continue;
    const isLoan = loanCodes.includes(code);
    items.push({
      key: `acct:${k}`,
      kind: isLoan ? "loan" : "other",
      book,
      accountCode: code,
      accountName: name(code),
      payee: name(code).replace(/^Loans Payable – /, ""),
      label: isLoan ? "No schedule (on demand); add it to the Loan Tracker for a due date" : "Balance owed",
      date: null,
      dueDate: null,
      openCents: cents,
      pendingCents: 0,
    });
  }

  const cashCents = [...bal].filter(([k]) => cashCodes.includes(k.split("|")[1])).reduce((s, [, v]) => s - v, 0);
  const out: PayablesSummary = { asOf: today, cashCents, items };
  return c.json(out);
});
