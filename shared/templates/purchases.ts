// Purchases, suppliers and reimbursements: #11-#18 and #30.

import { cashAccountsFor } from "../accounts";
import { NO_RECEIPT_LIMIT_CENTS } from "../dailyReport";
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
  STORE,
  str,
  type Template,
} from "./common";

/** Store encoders plus the Commissary In-charge, who records Commissary purchases. */
const PURCHASERS: Role[] = [...ENCODERS, "Commissary In-charge"];
const AP = "2100";
const ADVANCES_TO_SUPPLIERS = "1260";
const SMALLWARES = "6620";
export const CAPITALIZE_FROM_CENTS = 3000_00;

const linesField: Field = { name: "lines", label: "Items", type: "rows", required: true, columns: EXPENSE_COLUMNS };
const supplierField: Field = { name: "supplier", label: "Supplier", type: "party", partyType: "Supplier", required: true };

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
    { name: "receipt", label: "Receipt photo", type: "attachment" },
    { name: "noReceiptApproved", label: "No receipt; ₱300 or less and approved by the Supervisor", type: "checkbox" },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const { lines, totalCents } = expenseLines(rowsOf(v.lines), ctx, errors, "11.expense");
    let unsupported = false;
    if (!v.receipt) {
      if (totalCents > NO_RECEIPT_LIMIT_CENTS) errors.push("Over ₱300 needs a receipt photo.");
      else if (!v.noReceiptApproved) errors.push("Attach the receipt, or tick that the Supervisor approved it without one.");
      else unsupported = true;
    }
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
    { name: "paidFrom", label: "Paid from", type: "account", filter: "bank", required: true },
    { name: "reference", label: "Receipt / OR number", type: "text", required: true },
    linesField,
    { name: "receipt", label: "Receipt photo", type: "attachment", required: true },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const supplier = checkParty(str(v.supplier), "Supplier", "Supplier", ctx, errors);
    checkAccount(str(v.paidFrom), "bank", "Paid from", ctx, errors);
    const { lines, totalCents } = expenseLines(rowsOf(v.lines), ctx, errors, "12.expense");
    return result(
      errors,
      makeEntry(
        ctx,
        v,
        12,
        `Purchase from ${supplier?.name ?? "supplier"}`,
        [...lines.map((l) => ({ ...l, party_name: supplier?.name ?? null })), credit(str(v.paidFrom), totalCents, "12.paid")],
        { source_document: str(v.reference), attachments: attachmentsOf(v.receipt) },
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
    linesField,
    { name: "invoice", label: "Invoice photo", type: "attachment", required: true },
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
        [...lines.map((l) => ({ ...l, party_name: supplier?.name ?? null })), credit(AP, totalCents, "13.ap", partyExtras(supplier))],
        { source_document: str(v.reference), attachments: attachmentsOf(v.invoice) },
      ),
    );
  },
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
    { name: "amount", label: "Amount paid", type: "money", required: true },
    { name: "paidFrom", label: "Paid from", type: "account", filter: "bank", required: true },
    { name: "reference", label: "Invoice(s) paid", type: "text", required: true },
    { name: "proof", label: "Payment proof", type: "attachment" },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const supplier = checkParty(str(v.supplier), "Supplier", "Supplier", ctx, errors);
    checkAccount(str(v.paidFrom), "bank", "Paid from", ctx, errors);
    const amount = cents(v.amount);
    return result(
      errors,
      makeEntry(
        ctx,
        v,
        14,
        `Payment to ${supplier?.name ?? "supplier"}`,
        [debit(AP, amount, "14.ap", partyExtras(supplier)), credit(str(v.paidFrom), amount, "14.paid")],
        { source_document: str(v.reference), attachments: attachmentsOf(v.proof) },
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
    { name: "paidFrom", label: "Paid from", type: "account", filter: "bank", required: true },
    { name: "reference", label: "Reference", type: "text", required: true },
    { name: "proof", label: "Payment proof", type: "attachment" },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const supplier = checkParty(str(v.supplier), "Supplier", "Supplier", ctx, errors);
    checkAccount(str(v.paidFrom), "bank", "Paid from", ctx, errors);
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
    { name: "receipt", label: "Delivery receipt photo", type: "attachment", required: true },
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
        { source_document: str(v.reference), attachments: attachmentsOf(v.receipt) },
      ),
    );
  },
};

export const personalFundPurchase: Template = {
  number: 17,
  name: "Personal-Fund Purchase",
  group: "Purchases",
  roles: OWNERS_ACCOUNTANT,
  books: ALL_BOOKS,
  batchApproval: true,
  fields: [
    dateField,
    { name: "person", label: "Paid by (reimburse to)", type: "account", filter: "reimbursement", required: true },
    { name: "supplier", label: "Store / supplier", type: "text", required: true },
    { name: "reference", label: "Receipt number", type: "text" },
    linesField,
    { name: "receipt", label: "Receipt / owner's report", type: "attachment", required: true },
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
        { source_document: str(v.reference) || null, attachments: attachmentsOf(v.receipt) },
      ),
    );
  },
};

export const reimbursementPaid: Template = {
  number: 18,
  name: "Reimbursement Paid",
  group: "Purchases",
  roles: OWNERS_ACCOUNTANT,
  books: ALL_BOOKS,
  batchApproval: true,
  fields: [
    dateField,
    { name: "person", label: "Reimbursed to", type: "account", filter: "reimbursement", required: true },
    { name: "amount", label: "Amount", type: "money", required: true },
    { name: "paidFrom", label: "Paid from", type: "account", filter: "bank", required: true },
    { name: "reference", label: "Purchases covered", type: "text", required: true },
    { name: "proof", label: "Transfer proof", type: "attachment" },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const person = checkAccount(str(v.person), "reimbursement", "Reimbursed to", ctx, errors);
    checkAccount(str(v.paidFrom), "bank", "Paid from", ctx, errors);
    const amount = cents(v.amount);
    return result(
      errors,
      makeEntry(
        ctx,
        v,
        18,
        `Reimbursement: ${person?.name ?? ""}`,
        [debit(str(v.person), amount, "18.reimbursement"), credit(str(v.paidFrom), amount, "18.paid")],
        { source_document: str(v.reference), attachments: attachmentsOf(v.proof) },
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
        { value: "account", label: "From a bank, e-wallet or petty cash" },
        { value: "credit", label: "On credit (supplier)" },
      ],
    },
    { name: "paidFrom", label: "Paid from", type: "account", filter: "payFrom", required: true, showIf: { field: "paidBy", values: ["account"] } },
    { name: "supplier", label: "Supplier", type: "party", partyType: "Supplier", required: true, showIf: { field: "paidBy", values: ["credit"] } },
    { name: "receipt", label: "Receipt photo", type: "attachment", required: true },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const amount = cents(v.amount);
    if (amount >= CAPITALIZE_FROM_CENTS) errors.push(`${formatPeso(amount)} is ₱3,000 or more: record it as an Asset Purchase (#29).`);
    const onCredit = str(v.paidBy) === "credit";
    const supplier = onCredit ? checkParty(str(v.supplier), "Supplier", "Supplier", ctx, errors) : undefined;
    if (!onCredit) checkAccount(str(v.paidFrom), "payFrom", "Paid from", ctx, errors);
    return result(
      errors,
      makeEntry(
        ctx,
        v,
        30,
        str(v.description),
        [
          debit(SMALLWARES, amount, "30.smallwares", { profit_center: linePc(ctx, v.profitCenter), memo: str(v.description) }),
          onCredit ? credit(AP, amount, "30.ap", partyExtras(supplier)) : credit(str(v.paidFrom), amount, "30.paid"),
        ],
        { attachments: attachmentsOf(v.receipt) },
      ),
    );
  },
};
