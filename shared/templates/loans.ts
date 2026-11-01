// Loans and owner money: #33 loan proceeds (creates the Loan Tracker record and schedule),
// #34 installment (split from the schedule), #35-#38 owner loans and advances.

import { buildSchedule } from "../loans";
import { credit, debit } from "../entries";
import { fromCents } from "../money";
import {
  attachmentsOf,
  cents,
  checkAccount,
  checkParty,
  dateField,
  formatPeso,
  makeEntry,
  OWNERS_ACCOUNTANT,
  partyExtras,
  requireFields,
  result,
  STORE,
  str,
  type BuildResult,
  type Template,
} from "./common";

export const ACCRUED_INTEREST = "2250";
export const OWNER_LOANS = "2260";
export const ADVANCES_TO_OWNERS = "1250";
const LOAN_FEES = "7160";
const LOAN_BOOKS = ["Store", "Commissary"] as const;

export const loanProceeds: Template = {
  number: 33,
  name: "Loan Proceeds",
  group: "Loans & owners",
  roles: OWNERS_ACCOUNTANT,
  books: [...LOAN_BOOKS],
  batchApproval: false,
  fields: [
    dateField,
    { name: "name", label: "Loan name", type: "text", required: true, help: "e.g. UB loan (Nj card) 2026" },
    { name: "lender", label: "Lender", type: "party", partyType: "Lender", required: true },
    { name: "account", label: "Loans Payable account (one per loan)", type: "account", filter: "loan", required: true },
    { name: "interestAccount", label: "Interest expense account", type: "account", filter: "interest", required: true },
    { name: "principal", label: "Principal", type: "money", required: true },
    { name: "fees", label: "Fees deducted on release", type: "money" },
    { name: "receivedIn", label: "Received in", type: "account", filter: "bank", required: true },
    { name: "months", label: "Number of installments (months)", type: "number", required: true },
    { name: "firstDue", label: "First installment due", type: "date", required: true },
    {
      name: "basis",
      label: "Schedule from",
      type: "select",
      required: true,
      options: [
        { value: "installment", label: "The lender's fixed installment amount" },
        { value: "rate", label: "An agreed annual interest rate (informal loan)" },
        { value: "none", label: "No interest" },
      ],
    },
    { name: "installment", label: "Monthly installment", type: "money", required: true, showIf: { field: "basis", values: ["installment"] } },
    { name: "rate", label: "Annual interest rate (%)", type: "number", required: true, showIf: { field: "basis", values: ["rate"] } },
    { name: "proof", label: "Loan agreement / disclosure", type: "attachment", required: true },
  ],
  build(v, ctx): BuildResult {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const lender = checkParty(str(v.lender), "Lender", "Lender", ctx, errors);
    checkAccount(str(v.account), "loan", "Loans Payable account", ctx, errors);
    checkAccount(str(v.interestAccount), "interest", "Interest expense account", ctx, errors);
    checkAccount(str(v.receivedIn), "bank", "Received in", ctx, errors);
    for (const l of ctx.loans?.values() ?? []) {
      if (l.accountCode === str(v.account)) errors.push(`${str(v.account)} already holds ${l.name}. Add a new Loans Payable account for this loan.`);
    }
    const principal = cents(v.principal);
    const fees = cents(v.fees);
    const months = Math.floor(Number(v.months));
    if (fees >= principal && principal) errors.push("Fees can't be the whole loan.");
    const basis = str(v.basis);
    const schedule =
      principal > 0 && months > 0 && str(v.firstDue)
        ? buildSchedule({
            principalCents: principal,
            months,
            firstDue: str(v.firstDue),
            installmentCents: basis === "installment" ? cents(v.installment) : undefined,
            annualRatePct: basis === "rate" ? Number(v.rate) : 0,
          })
        : null;
    if (basis === "installment" && schedule && cents(v.installment) * months < principal) {
      errors.push("The installments don't cover the principal.");
    }
    const entry = makeEntry(
      ctx,
      v,
      33,
      `Loan received: ${str(v.name)}`,
      [
        debit(str(v.receivedIn), principal - fees, "33.received"),
        debit(LOAN_FEES, fees, "33.fees", { profit_center: ctx.book === "Commissary" ? "GGC" : ctx.profitCenter }),
        credit(str(v.account), principal, "33.loan", partyExtras(lender)),
      ],
      { attachments: attachmentsOf(v.proof) },
    );
    return {
      ...result(errors, entry),
      register: {
        type: "loan",
        data: {
          name: str(v.name),
          lender_party_id: lender?.id ?? null,
          lender_name: lender?.name ?? "",
          account_code: str(v.account),
          interest_account: str(v.interestAccount),
          book: ctx.book,
          principal: principal / 100,
          annual_rate: schedule?.annualRatePct ?? 0,
          term_months: months,
          start_date: str(v.date),
          informal: basis !== "installment",
          installments: (schedule?.installments ?? []).map((i) => ({
            seq: i.seq,
            due_date: i.dueDate,
            principal: fromCents(i.principalCents),
            interest: fromCents(i.interestCents),
          })),
        },
      },
    };
  },
};

export const loanInstallment: Template = {
  number: 34,
  name: "Loan Installment",
  group: "Loans & owners",
  roles: OWNERS_ACCOUNTANT,
  books: [...LOAN_BOOKS],
  batchApproval: true,
  fields: [
    dateField,
    { name: "loan", label: "Loan", type: "loan", required: true },
    { name: "paidFrom", label: "Paid from", type: "account", filter: "bank", required: true },
    { name: "reference", label: "Payment reference", type: "text", required: true },
    { name: "proof", label: "Payment proof", type: "attachment" },
  ],
  build(v, ctx): BuildResult {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    checkAccount(str(v.paidFrom), "bank", "Paid from", ctx, errors);
    const loan = ctx.loans?.get(str(v.loan));
    if (str(v.loan) && !loan) errors.push("Choose a loan.");
    if (loan && loan.book !== ctx.book) errors.push(`${loan.name} is in the ${loan.book} book.`);
    if (loan && !loan.next) errors.push(`${loan.name} has no unpaid installments.`);
    const next = loan?.next;
    // The split always comes from the schedule; interest already accrued clears Accrued Interest Payable.
    const principal = next ? Math.round(next.principal * 100) : 0;
    const interest = next ? Math.round(next.interest * 100) : 0;
    const accrued = next ? Math.min(Math.round(next.accrued * 100), interest) : 0;
    const total = principal + interest;
    const entry = loan
      ? makeEntry(
          ctx,
          v,
          34,
          `${loan.name}: installment ${next?.dueDate ?? ""} (${formatPeso(total)})`,
          [
            debit(loan.accountCode, principal, "34.principal"),
            debit(ACCRUED_INTEREST, accrued, "34.accrued", { party_id: `loan:${loan.id}`, party_name: loan.name }),
            debit(loan.interestAccount, interest - accrued, "34.interest", { profit_center: ctx.book === "Commissary" ? "GGC" : ctx.profitCenter }),
            credit(str(v.paidFrom), total, "34.paid"),
          ],
          { source_document: str(v.reference), attachments: attachmentsOf(v.proof) },
        )
      : null;
    return { ...result(errors, entry), register: next ? { type: "loan_payment", data: { installment_id: next.id } } : undefined };
  },
};

function ownerTemplate(
  number: number,
  name: string,
  batchApproval: boolean,
  build: (owner: ReturnType<typeof partyExtras>, amount: number, bank: string) => ReturnType<typeof debit>[],
  description: (owner: string) => string,
): Template {
  return {
    number,
    name,
    group: "Loans & owners",
    roles: OWNERS_ACCOUNTANT,
    books: STORE,
    batchApproval,
    fields: [
      dateField,
      { name: "owner", label: "Owner", type: "party", partyType: "Owner", required: true },
      { name: "amount", label: "Amount", type: "money", required: true },
      { name: "bank", label: "Bank / e-wallet", type: "account", filter: "bank", required: true },
      { name: "reference", label: "Reference", type: "text", required: true },
      { name: "proof", label: "Proof", type: "attachment" },
    ],
    build(v, ctx) {
      const errors: string[] = [];
      requireFields(this.fields, v, ctx, errors);
      const owner = checkParty(str(v.owner), "Owner", "Owner", ctx, errors);
      checkAccount(str(v.bank), "bank", "Bank / e-wallet", ctx, errors);
      return result(
        errors,
        makeEntry(ctx, v, number, description(owner?.name ?? "owner"), build(partyExtras(owner), cents(v.amount), str(v.bank)), {
          source_document: str(v.reference),
          attachments: attachmentsOf(v.proof),
        }),
      );
    },
  };
}

// Money an owner puts in is a loan by default (no interest unless agreed in writing).
export const ownerMoneyIn = ownerTemplate(
  35,
  "Owner Money In",
  true,
  (o, amt, bank) => [debit(bank, amt, "35.bank"), credit(OWNER_LOANS, amt, "35.owner_loan", o)],
  (n) => `Owner loan from ${n}`,
);
export const ownerLoanRepayment = ownerTemplate(
  36,
  "Owner Loan Repayment",
  false,
  (o, amt, bank) => [debit(OWNER_LOANS, amt, "36.owner_loan", o), credit(bank, amt, "36.bank")],
  (n) => `Owner loan repaid to ${n}`,
);
// Money an owner takes out is an advance, tracked per person, never netted against their loans.
export const ownerMoneyOut = ownerTemplate(
  37,
  "Owner Money Out",
  true,
  (o, amt, bank) => [debit(ADVANCES_TO_OWNERS, amt, "37.advance", o), credit(bank, amt, "37.bank")],
  (n) => `Advance to ${n}`,
);
export const RECEIVABLE_OWNER_FOOD = "1255";

// Repays an advance (1250) or food taken above the monthly allowance (1255).
export const ownerAdvanceReturned: Template = {
  ...ownerTemplate(38, "Owner Advance / Food Charges Repaid", true, () => [], () => ""),
  fields: [
    dateField,
    { name: "owner", label: "Owner", type: "party", partyType: "Owner", required: true },
    {
      name: "repays",
      label: "Paying back",
      type: "select",
      required: true,
      options: [
        { value: ADVANCES_TO_OWNERS, label: "An advance (money taken out)" },
        { value: RECEIVABLE_OWNER_FOOD, label: "Food above the monthly allowance" },
      ],
    },
    { name: "amount", label: "Amount", type: "money", required: true },
    { name: "bank", label: "Received in (bank / e-wallet)", type: "account", filter: "bank", required: true },
    { name: "reference", label: "Reference", type: "text", required: true },
    { name: "proof", label: "Proof", type: "attachment" },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const owner = checkParty(str(v.owner), "Owner", "Owner", ctx, errors);
    checkAccount(str(v.bank), "bank", "Bank / e-wallet", ctx, errors);
    const food = str(v.repays) === RECEIVABLE_OWNER_FOOD;
    const amount = cents(v.amount);
    return result(
      errors,
      makeEntry(
        ctx,
        v,
        38,
        `${food ? "Food charges above allowance" : "Advance"} repaid by ${owner?.name ?? "owner"}`,
        [debit(str(v.bank), amount, "38.bank"), credit(food ? RECEIVABLE_OWNER_FOOD : ADVANCES_TO_OWNERS, amount, "38.advance", partyExtras(owner))],
        { source_document: str(v.reference), attachments: attachmentsOf(v.proof) },
      ),
    );
  },
};
