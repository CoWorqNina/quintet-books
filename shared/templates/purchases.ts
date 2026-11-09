// Purchases, suppliers and reimbursements: #11-#18 and #30.

import { cashAccountsFor, isCardAccount } from "../accounts";
import { credit, debit } from "../entries";
import type { Role } from "../types";
import {
  ALL_BOOKS,
  attachmentsOf,
  cents,
  checkAccount,
  checkParty,
  dateField,
  ENCODERS,
  EXPENSE_COLUMNS,
  expenseLines,
  type Field,
  formatPeso,
  linePc,
  makeEntry,
  OWNERS_ACCOUNTANT,
  partyExtras,
  requireFields,
  result,
  rowsOf,
  settleLines,
  STORE,
  str,
  type Template,
  type TemplateContext,
  mainSourceField,
  otherSources,
  otherSourcesField,
  transferFeeField,
  transferFeeLines,
} from "./common";

/** Store encoders plus the Commissary In-charge, who records Commissary purchases. */
const PURCHASERS: Role[] = [...ENCODERS, "Commissary In-charge", "Partner"];
const AP = "2100";
const ADVANCES_TO_SUPPLIERS = "1260";
const SMALLWARES = "6620";
export const CAPITALIZE_FROM_CENTS = 3000_00;

const linesField: Field = { name: "lines", label: "Items", type: "rows", required: true, columns: EXPENSE_COLUMNS };
const supplierField: Field = { name: "supplier", label: "Supplier", type: "party", partyType: "Supplier", required: true };

/**
 * The credit for what was paid. Charged to an owner's card or SPayLater, it becomes a bill on that
 * card (named after the supplier) to tick off when the card is paid with #18.
 */
export function paidLine(ctx: TemplateContext, code: string, cents: number, templateLine: string, supplier: string | null, memo: string | null) {
  return isCardAccount(ctx.accounts.get(code))
    ? credit(code, cents, templateLine, { party_name: supplier, memo: [supplier, memo].filter(Boolean).join(" – ") || null })
    : credit(code, cents, templateLine);
}

export const pettyCashExpense: Template = {
  number: 11,
  name: "Petty Cash Expense",
  group: "Purchases",
  roles: ENCODERS,
  books: STORE,
  batchApproval: true,
  fields: [
    dateField,
    { name: "description", label: "What was bought", type: "text", required: true },
    { name: "supplier", label: "Store / supplier", type: "text" },
    linesField,
    { name: "receipt", label: "Receipt photo", type: "attachment", help: "Optional. Without it the entry is flagged \"No receipt\" for the approver" },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const { lines, totalCents } = expenseLines(rowsOf(v.lines), ctx, errors, "11.expense");
    const unsupported = !v.receipt;
    const supplier = str(v.supplier) || null;
    return result(
      errors,
      makeEntry(
        ctx,
        v,
        11,
        str(v.description),
        [...lines.map((l) => ({ ...l, party_name: supplier })), credit(cashAccountsFor(ctx.profitCenter).pettyCash, totalCents, "11.petty_cash")],
        { source_document: supplier, unsupported, attachments: attachmentsOf(v.receipt) },
      ),
    );
  },
};

export const purchasePaid: Template = {
  number: 12,
  name: "Purchase – Paid",
  group: "Purchases",
  roles: PURCHASERS,
  books: ALL_BOOKS,
  batchApproval: true,
  fields: [
    dateField,
    supplierField,
    {
      name: "paidFrom",
      label: "Paid from / charged to",
      type: "account",
      filter: "bankOrCard",
      required: true,
      help: "A bank or e-wallet, cash on hand for deposit, or an owner's credit card or SPayLater",
    },
    { name: "reference", label: "Receipt / OR number", type: "text", required: true },
    linesField,
    { name: "receipt", label: "Receipt photo", type: "attachment", help: "Optional. Without it the entry is flagged \"No receipt\" for the approver" },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const supplier = checkParty(str(v.supplier), "Supplier", "Supplier", ctx, errors);
    checkAccount(str(v.paidFrom), "bankOrCard", "Paid from", ctx, errors);
    const { lines, totalCents } = expenseLines(rowsOf(v.lines), ctx, errors, "12.expense");
    return result(
      errors,
      makeEntry(
        ctx,
        v,
        12,
        `Purchase from ${supplier?.name ?? "supplier"}`,
        [
          ...lines.map((l) => ({ ...l, party_name: supplier?.name ?? null })),
          paidLine(ctx, str(v.paidFrom), totalCents, "12.paid", supplier?.name ?? null, str(v.reference) || null),
        ],
        { source_document: str(v.reference), attachments: attachmentsOf(v.receipt), unsupported: !v.receipt },
      ),
    );
  },
};

export const purchaseOnCredit: Template = {
  number: 13,
  name: "Purchase – On Credit",
  group: "Purchases",
  roles: PURCHASERS,
  books: ALL_BOOKS,
  batchApproval: true,
  fields: [
    dateField,
    supplierField,
    { name: "reference", label: "Invoice number", type: "text", required: true },
    { name: "deliveryDate", label: "Delivery date", type: "date", required: true },
    { name: "dueDate", label: "Due date", type: "date", help: "When the supplier expects payment" },
    linesField,
    { name: "invoice", label: "Invoice photo", type: "attachment", help: "Optional. Without it the entry is flagged \"No receipt\" for the approver" },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const supplier = checkParty(str(v.supplier), "Supplier", "Supplier", ctx, errors);
    const { lines, totalCents } = expenseLines(rowsOf(v.lines), ctx, errors, "13.expense");
    return result(
      errors,
      makeEntry(
        ctx,
        v,
        13,
        `Credit purchase from ${supplier?.name ?? "supplier"}, delivered ${str(v.deliveryDate)}`,
        [
          ...lines.map((l) => ({ ...l, party_name: supplier?.name ?? null })),
          credit(AP, totalCents, "13.ap", {
            ...partyExtras(supplier),
            memo: str(v.reference) ? `Invoice ${str(v.reference)}` : null,
            due_date: str(v.dueDate) || null,
          }),
        ],
        { source_document: str(v.reference), attachments: attachmentsOf(v.invoice), unsupported: !v.invoice },
      ),
    );
  },
};

const supplierBills: Field = {
  name: "bills",
  label: "Bills paid",
  type: "openItems",
  required: true,
  itemsAccount: AP,
  itemsPartyField: "supplier",
  help: "Tick the invoices being paid; change the amount for a partial payment",
};

export const supplierPayment: Template = {
  number: 14,
  name: "Supplier Payment",
  group: "Purchases",
  roles: OWNERS_ACCOUNTANT,
  books: ALL_BOOKS,
  batchApproval: true,
  fields: [
    dateField,
    supplierField,
    supplierBills,
    {
      name: "paidFrom",
      label: "Paid from / charged to",
      type: "account",
      filter: "bankOrCard",
      required: true,
      help: "A bank or e-wallet, cash on hand for deposit, or an owner's credit card or SPayLater",
    },
    mainSourceField,
    transferFeeField,
    otherSourcesField,
    { name: "reference", label: "Transfer / check reference", type: "text" },
    { name: "proof", label: "Payment proof", type: "attachment" },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const supplier = checkParty(str(v.supplier), "Supplier", "Supplier", ctx, errors);
    const from = checkAccount(str(v.paidFrom), "bankOrCard", "Paid from", ctx, errors);
    const { lines, totalCents, labels } = settleLines(supplierBills, v, ctx, errors, "14.ap");
    const fee = transferFeeLines(v, ctx, "14.fee", errors, from);
    const split = otherSources(v, ctx, totalCents, "14.paid", errors, str(v.paidFrom));
    return result(
      errors,
      makeEntry(
        ctx,
        v,
        14,
        `Payment to ${supplier?.name ?? "supplier"}`,
        [
          ...lines,
          ...fee.lines,
          ...split.feeLines,
          paidLine(ctx, str(v.paidFrom), split.mainCents + fee.feeCents, "14.paid", supplier?.name ?? null, labels.join(", ")),
          ...split.credits,
        ],
        { source_document: [labels.join(", "), str(v.reference)].filter(Boolean).join(" · ") || null, attachments: attachmentsOf(v.proof) },
      ),
    );
  },
};

export const supplierAdvance: Template = {
  number: 15,
  name: "Supplier Advance",
  group: "Purchases",
  roles: OWNERS_ACCOUNTANT,
  books: ALL_BOOKS,
  batchApproval: true,
  fields: [
    dateField,
    supplierField,
    { name: "amount", label: "Amount paid in advance", type: "money", required: true },
    { name: "paidFrom", label: "Paid from", type: "account", filter: "payment", required: true, help: "A bank or e-wallet, or cash on hand for deposit" },
    { name: "reference", label: "Reference", type: "text", required: true },
    { name: "proof", label: "Payment proof", type: "attachment" },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const supplier = checkParty(str(v.supplier), "Supplier", "Supplier", ctx, errors);
    checkAccount(str(v.paidFrom), "payment", "Paid from", ctx, errors);
    const amount = cents(v.amount);
    return result(
      errors,
      makeEntry(
        ctx,
        v,
        15,
        `Advance to ${supplier?.name ?? "supplier"}`,
        [debit(ADVANCES_TO_SUPPLIERS, amount, "15.advance", partyExtras(supplier)), credit(str(v.paidFrom), amount, "15.paid")],
        { source_document: str(v.reference), attachments: attachmentsOf(v.proof) },
      ),
    );
  },
};

export const advanceApplied: Template = {
  number: 16,
  name: "Advance Applied on Delivery",
  group: "Purchases",
  roles: PURCHASERS,
  books: ALL_BOOKS,
  batchApproval: true,
  fields: [
    dateField,
    supplierField,
    { name: "reference", label: "Delivery receipt number", type: "text", required: true },
    linesField,
    { name: "receipt", label: "Delivery receipt photo", type: "attachment", help: "Optional. Without it the entry is flagged \"No receipt\" for the approver" },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const supplier = checkParty(str(v.supplier), "Supplier", "Supplier", ctx, errors);
    const { lines, totalCents } = expenseLines(rowsOf(v.lines), ctx, errors, "16.expense");
    return result(
      errors,
      makeEntry(
        ctx,
        v,
        16,
        `Delivery against advance: ${supplier?.name ?? "supplier"}`,
        [
          ...lines.map((l) => ({ ...l, party_name: supplier?.name ?? null })),
          credit(ADVANCES_TO_SUPPLIERS, totalCents, "16.advance", partyExtras(supplier)),
        ],
        { source_document: str(v.reference), attachments: attachmentsOf(v.receipt), unsupported: !v.receipt },
      ),
    );
  },
};

export const personalFundPurchase: Template = {
  number: 17,
  name: "Personal-Fund Purchase",
  group: "Purchases",
  roles: [...OWNERS_ACCOUNTANT, "Partner"],
  books: ALL_BOOKS,
  batchApproval: true,
  fields: [
    dateField,
    { name: "person", label: "Paid by (reimburse to)", type: "account", filter: "reimbursement", required: true },
    { name: "supplier", label: "Store / supplier", type: "text", required: true },
    { name: "reference", label: "Receipt number", type: "text" },
    linesField,
    { name: "receipt", label: "Receipt / owner's report", type: "attachment", help: "Optional. Without it the entry is flagged \"No receipt\" for the approver" },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const person = checkAccount(str(v.person), "reimbursement", "Paid by", ctx, errors);
    const { lines, totalCents } = expenseLines(rowsOf(v.lines), ctx, errors, "17.expense");
    const supplier = str(v.supplier);
    return result(
      errors,
      makeEntry(
        ctx,
        v,
        17,
        `Bought with personal funds (${person?.name.replace("Reimbursements Payable – ", "") ?? "owner"}) at ${supplier}`,
        [...lines.map((l) => ({ ...l, party_name: supplier })), credit(str(v.person), totalCents, "17.reimbursement")],
        { source_document: str(v.reference) || null, attachments: attachmentsOf(v.receipt), unsupported: !v.receipt },
      ),
    );
  },
};

const payableBills: Field = {
  name: "bills",
  label: "Charges paid",
  type: "openItems",
  required: true,
  itemsAccountField: "person",
  help: "Tick the charges being paid; change the amount for a partial payment",
};

export const reimbursementPaid: Template = {
  number: 18,
  name: "Card, SPayLater or Reimbursement Payment",
  group: "Purchases",
  roles: OWNERS_ACCOUNTANT,
  books: ALL_BOOKS,
  batchApproval: true,
  fields: [
    dateField,
    { name: "person", label: "Card, SPayLater or person paid", type: "account", filter: "payable", required: true },
    payableBills,
    { name: "paidFrom", label: "Paid from", type: "account", filter: "payment", required: true, help: "A bank or e-wallet, or cash on hand for deposit" },
    mainSourceField,
    transferFeeField,
    otherSourcesField,
    { name: "reference", label: "Transfer reference", type: "text" },
    { name: "proof", label: "Transfer proof", type: "attachment" },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const payable = checkAccount(str(v.person), "payable", "Card, SPayLater or person", ctx, errors);
    const bank = checkAccount(str(v.paidFrom), "payment", "Paid from", ctx, errors);
    const { lines, totalCents, labels } = settleLines(payableBills, v, ctx, errors, "18.reimbursement");
    const fee = transferFeeLines(v, ctx, "18.fee", errors, bank);
    const split = otherSources(v, ctx, totalCents, "18.paid", errors, str(v.paidFrom));
    return result(
      errors,
      makeEntry(
        ctx,
        v,
        18,
        `Paid: ${payable?.name ?? ""}`,
        [...lines, ...fee.lines, ...split.feeLines, credit(str(v.paidFrom), split.mainCents + fee.feeCents, "18.paid"), ...split.credits],
        { source_document: [str(v.reference), `${labels.length} charge${labels.length === 1 ? "" : "s"}`].filter(Boolean).join(" · "), attachments: attachmentsOf(v.proof) },
      ),
    );
  },
};

export const smallItem: Template = {
  number: 30,
  name: "Small Item (under ₱3,000)",
  group: "Purchases",
  roles: PURCHASERS,
  books: ALL_BOOKS,
  batchApproval: true,
  fields: [
    dateField,
    { name: "description", label: "Item", type: "text", required: true },
    { name: "amount", label: "Full cost (all installments)", type: "money", required: true },
    { name: "profitCenter", label: "Profit center", type: "profitCenter", storeOnly: true },
    {
      name: "paidBy",
      label: "Paid",
      type: "select",
      required: true,
      options: [
        { value: "account", label: "From a bank, e-wallet, petty cash, or an owner's card / SPayLater" },
        { value: "credit", label: "On credit (supplier)" },
      ],
    },
    { name: "paidFrom", label: "Paid from / charged to", type: "account", filter: "payFromOrCard", required: true, showIf: { field: "paidBy", values: ["account"] } },
    { name: "supplier", label: "Supplier", type: "party", partyType: "Supplier", required: true, showIf: { field: "paidBy", values: ["credit"] } },
    { name: "receipt", label: "Receipt photo", type: "attachment", help: "Optional. Without it the entry is flagged \"No receipt\" for the approver" },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const amount = cents(v.amount);
    if (amount >= CAPITALIZE_FROM_CENTS) errors.push(`${formatPeso(amount)} is ₱3,000 or more: record it as an Asset Purchase (#29).`);
    const onCredit = str(v.paidBy) === "credit";
    const supplier = onCredit ? checkParty(str(v.supplier), "Supplier", "Supplier", ctx, errors) : undefined;
    if (!onCredit) checkAccount(str(v.paidFrom), "payFromOrCard", "Paid from", ctx, errors);
    return result(
      errors,
      makeEntry(
        ctx,
        v,
        30,
        str(v.description),
        [
          debit(SMALLWARES, amount, "30.smallwares", { profit_center: linePc(ctx, v.profitCenter), memo: str(v.description) }),
          onCredit ? credit(AP, amount, "30.ap", partyExtras(supplier)) : paidLine(ctx, str(v.paidFrom), amount, "30.paid", null, str(v.description)),
        ],
        { attachments: attachmentsOf(v.receipt), unsupported: !v.receipt },
      ),
    );
  },
};
