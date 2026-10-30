// Sales outside the daily report, payouts, deposits, transfers, bank charges and
// unclassified cash movements: #5, #7, #8, #9, #10, #39, #40.

import { ACCOUNTS, cashAccountsFor } from "../accounts";
import { credit, debit } from "../entries";
import {
  ALL_BOOKS,
  attachmentsOf,
  cents,
  checkAccount,
  dateField,
  ENCODERS,
  formatPeso,
  makeEntry,
  OWNERS_ACCOUNTANT,
  requireFields,
  result,
  STORE,
  str,
  type Template,
} from "./common";

export const popUpSales: Template = {
  number: 5,
  name: "Pop-up & Event Sales",
  group: "Sales",
  roles: ENCODERS,
  books: STORE,
  batchApproval: true,
  fields: [
    dateField,
    { name: "event", label: "Event name", type: "text", required: true },
    {
      name: "channel",
      label: "Paid by",
      type: "select",
      required: true,
      options: [
        { value: "cash", label: "Cash" },
        { value: "gcash", label: "GCash" },
        { value: "card", label: "Card" },
      ],
    },
    { name: "amount", label: "Net sales (after discounts)", type: "money", required: true },
    { name: "discounts", label: "Discounts", type: "money" },
    {
      name: "discountAccount",
      label: "Discount type",
      type: "select",
      options: [
        { value: ACCOUNTS.discountScPwd, label: "SC/PWD" },
        { value: ACCOUNTS.discountPromo, label: "Promo" },
      ],
    },
    { name: "proof", label: "POS reading / sales report", type: "attachment" },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const cash = cashAccountsFor(ctx.profitCenter);
    const channel = str(v.channel);
    const target = channel === "cash" ? cash.forDeposit : channel === "gcash" ? cash.gcash : cash.cardClearing;
    const sales = channel === "cash" ? ACCOUNTS.popupCash : channel === "gcash" ? ACCOUNTS.popupGcash : ACCOUNTS.popupCard;
    const amount = cents(v.amount);
    const discounts = cents(v.discounts);
    if (discounts > 0 && !str(v.discountAccount)) errors.push("Choose the discount type.");
    const event = str(v.event);
    const pc = { profit_center: ctx.profitCenter };
    return result(
      errors,
      makeEntry(
        ctx,
        v,
        5,
        `Pop-up sales: ${event}`,
        [
          debit(target ?? "", amount, "5.receipt"),
          debit(str(v.discountAccount) || ACCOUNTS.discountPromo, discounts, "5.discounts", pc),
          credit(sales, amount + discounts, "5.sales", { ...pc, party_name: event, memo: event }),
        ],
        { attachments: attachmentsOf(v.proof) },
      ),
    );
  },
};

export const cardPayout: Template = {
  number: 7,
  name: "Card Payout",
  group: "Cash & bank",
  roles: OWNERS_ACCOUNTANT,
  books: STORE,
  batchApproval: true,
  fields: [
    dateField,
    { name: "bank", label: "Received in", type: "account", filter: "bank", required: true },
    { name: "gross", label: "Card sales cleared (gross)", type: "money", required: true },
    { name: "fees", label: "Card fees deducted", type: "money" },
    { name: "reference", label: "Bank credit reference", type: "text", required: true },
    { name: "proof", label: "Bank statement / payout notice", type: "attachment" },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const cash = cashAccountsFor(ctx.profitCenter);
    checkAccount(str(v.bank), "bank", "Received in", ctx, errors);
    const gross = cents(v.gross);
    const fees = cents(v.fees);
    if (fees > gross) errors.push("Fees can't be more than the gross amount.");
    return result(
      errors,
      makeEntry(
        ctx,
        v,
        7,
        `Card payout, net ${formatPeso(gross - fees)}`,
        [
          debit(str(v.bank), gross - fees, "7.bank"),
          debit(ACCOUNTS.cardFees, fees, "7.fees", { profit_center: ctx.profitCenter }),
          credit(cash.cardClearing, gross, "7.clearing"),
        ],
        { source_document: str(v.reference), attachments: attachmentsOf(v.proof) },
      ),
    );
  },
};

export const platformPayout: Template = {
  number: 8,
  name: "Grab / Foodpanda Payout",
  group: "Cash & bank",
  roles: OWNERS_ACCOUNTANT,
  books: STORE,
  batchApproval: true,
  fields: [
    dateField,
    {
      name: "platform",
      label: "Platform",
      type: "select",
      required: true,
      options: [
        { value: "Grab", label: "Grab" },
        { value: "Foodpanda", label: "Foodpanda" },
      ],
    },
    { name: "receivedIn", label: "Received in", type: "account", filter: "bank", required: true },
    { name: "gross", label: "Sales cleared (gross, at menu price)", type: "money", required: true },
    { name: "commission", label: "Commission", type: "money" },
    { name: "deductions", label: "Penalties and adjustments", type: "money" },
    { name: "withholding", label: "Tax withheld", type: "money" },
    { name: "reference", label: "Statement / payout reference", type: "text", required: true },
    { name: "proof", label: "Weekly platform statement", type: "attachment", required: true },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const cash = cashAccountsFor(ctx.profitCenter);
    const grab = str(v.platform) === "Grab";
    const receiving = str(v.receivedIn);
    checkAccount(receiving, "bank", "Received in", ctx, errors);
    const gross = cents(v.gross);
    const commission = cents(v.commission);
    const deductions = cents(v.deductions);
    const withholding = cents(v.withholding);
    const net = gross - commission - deductions - withholding;
    if (net < 0) errors.push("Deductions can't be more than the gross amount.");
    const pc = { profit_center: ctx.profitCenter };
    return result(
      errors,
      makeEntry(
        ctx,
        v,
        8,
        `${str(v.platform)} payout, net ${formatPeso(net)}`,
        [
          debit(receiving, net, "8.received"),
          debit(grab ? ACCOUNTS.commissionGrab : ACCOUNTS.commissionFoodpanda, commission, "8.commission", pc),
          debit(grab ? ACCOUNTS.deductionsGrab : ACCOUNTS.deductionsFoodpanda, deductions, "8.deductions", pc),
          debit(ACCOUNTS.creditableWithholdingTax, withholding, "8.cwt", { party_name: str(v.platform) }),
          credit(grab ? cash.grabClearing : cash.foodpandaClearing, gross, "8.clearing"),
        ],
        { source_document: str(v.reference), attachments: attachmentsOf(v.proof) },
      ),
    );
  },
};

export const cashDeposit: Template = {
  number: 9,
  name: "Cash Deposit",
  group: "Cash & bank",
  roles: [...OWNERS_ACCOUNTANT, "Supervisor"],
  books: STORE,
  batchApproval: true,
  fields: [
    dateField,
    { name: "bank", label: "Deposited to", type: "account", filter: "bank", required: true },
    { name: "amount", label: "Amount deposited", type: "money", required: true },
    { name: "reference", label: "Deposit slip number", type: "text", required: true },
    { name: "proof", label: "Deposit slip photo", type: "attachment", required: true },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const cash = cashAccountsFor(ctx.profitCenter);
    checkAccount(str(v.bank), "bank", "Deposited to", ctx, errors);
    const amount = cents(v.amount);
    return result(
      errors,
      makeEntry(
        ctx,
        v,
        9,
        `Cash deposit ${formatPeso(amount)}`,
        [debit(str(v.bank), amount, "9.bank"), credit(cash.forDeposit, amount, "9.cash")],
        { source_document: str(v.reference), attachments: attachmentsOf(v.proof) },
      ),
    );
  },
};

export const transfer: Template = {
  number: 10,
  name: "Transfer Between Own Accounts",
  group: "Cash & bank",
  roles: OWNERS_ACCOUNTANT,
  books: ALL_BOOKS,
  batchApproval: true,
  fields: [
    dateField,
    { name: "from", label: "From (sending account)", type: "account", filter: "cash", required: true },
    { name: "to", label: "To (receiving account)", type: "account", filter: "cash", required: true },
    { name: "amount", label: "Amount", type: "money", required: true },
    { name: "fromReference", label: "Sending reference", type: "text", required: true },
    { name: "toReference", label: "Receiving reference", type: "text", required: true },
    { name: "proof", label: "Transfer receipt", type: "attachment" },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const from = str(v.from);
    const to = str(v.to);
    checkAccount(from, "cash", "From", ctx, errors);
    checkAccount(to, "cash", "To", ctx, errors);
    if (from && from === to) errors.push("Sending and receiving accounts must differ.");
    const amount = cents(v.amount);
    return result(
      errors,
      makeEntry(ctx, v, 10, `Transfer ${from} → ${to}`, [debit(to, amount, "10.receiving"), credit(from, amount, "10.sending")], {
        source_document: `${str(v.fromReference)} / ${str(v.toReference)}`,
        attachments: attachmentsOf(v.proof),
      }),
    );
  },
};

export const unclassifiedCash: Template = {
  number: 39,
  name: "Unclassified Cash Movement",
  group: "Cash & bank",
  roles: OWNERS_ACCOUNTANT,
  books: ALL_BOOKS,
  batchApproval: true,
  fields: [
    dateField,
    {
      name: "direction",
      label: "Money",
      type: "select",
      required: true,
      options: [
        { value: "out", label: "Went out" },
        { value: "in", label: "Came in" },
      ],
    },
    { name: "account", label: "Account", type: "account", filter: "cash", required: true },
    { name: "amount", label: "Amount", type: "money", required: true },
    { name: "description", label: "What is known about it", type: "text", required: true },
    { name: "reference", label: "Reference", type: "text" },
    { name: "proof", label: "Statement / proof", type: "attachment" },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    checkAccount(str(v.account), "cash", "Account", ctx, errors);
    const amount = cents(v.amount);
    const out = str(v.direction) !== "in";
    const lines = out
      ? [debit(ACCOUNTS.suspense, amount, "39.suspense"), credit(str(v.account), amount, "39.cash")]
      : [debit(str(v.account), amount, "39.cash"), credit(ACCOUNTS.suspense, amount, "39.suspense")];
    return result(
      errors,
      makeEntry(ctx, v, 39, str(v.description), lines, {
        source_document: str(v.reference) || null,
        attachments: attachmentsOf(v.proof),
      }),
    );
  },
};

export const bankCharges: Template = {
  number: 40,
  name: "Bank Charges",
  group: "Cash & bank",
  roles: OWNERS_ACCOUNTANT,
  books: ALL_BOOKS,
  batchApproval: true,
  fields: [
    dateField,
    { name: "bank", label: "Charged to", type: "account", filter: "bank", required: true },
    { name: "amount", label: "Amount", type: "money", required: true },
    { name: "description", label: "Charge", type: "text", required: true, help: "Service charge, transfer fee, minimum-balance penalty…" },
    { name: "proof", label: "Bank statement or transfer receipt", type: "attachment", required: true },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    checkAccount(str(v.bank), "bank", "Charged to", ctx, errors);
    const amount = cents(v.amount);
    return result(
      errors,
      makeEntry(
        ctx,
        v,
        40,
        str(v.description),
        [
          debit("6740", amount, "40.charges", { profit_center: ctx.book === "Commissary" ? "GGC" : ctx.profitCenter }),
          credit(str(v.bank), amount, "40.bank"),
        ],
        { attachments: attachmentsOf(v.proof) },
      ),
    );
  },
};
