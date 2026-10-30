// Section 7 templates that are entered one at a time (outside the daily report). Each declares
// the fields the encoder fills in and builds the entry from them; the encoder never picks
// debits or credits. The daily report (dailyReport.ts) covers #1-#4, #6 and drawer paid-outs.

import { ACCOUNTS, bookAllowed, cashAccountsFor, isExpenseAccount, needsQuantity, profitCenterAllowed } from "./accounts";
import { NO_RECEIPT_LIMIT_CENTS } from "./dailyReport";
import { credit, debit, type Attachment, type EntryDraft, finishEntry } from "./entries";
import { formatPeso, toCents } from "./money";
import type { Account, Role } from "./types";

export type FieldType = "date" | "money" | "text" | "select" | "expenseAccount" | "attachment" | "number" | "checkbox";

export interface Field {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: { value: string; label: string }[];
  help?: string;
  /** Show only when another field has one of these values. */
  showIf?: { field: string; values: string[] };
}

export type Values = Record<string, string | number | boolean | Attachment | null | undefined>;

export interface TemplateContext {
  profitCenter: "GGC" | "The Nest";
  accounts: Map<string, Account>;
}

export interface BuildResult {
  entry: EntryDraft | null;
  errors: string[];
}

export interface Template {
  number: number;
  name: string;
  roles: Role[];
  /** Routine entries may be approved in the daily batch; the rest one by one. */
  batchApproval: boolean;
  fields: Field[];
  build(values: Values, ctx: TemplateContext): BuildResult;
}

const ENCODERS: Role[] = ["Owner", "Accountant", "Supervisor", "Staff"];
const OWNERS_ACCOUNTANT: Role[] = ["Owner", "Accountant"];

const str = (v: Values[string]) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));
const att = (v: Values[string]) => (v && typeof v === "object" ? (v as Attachment) : null);
const cents = (v: Values[string]) => toCents(typeof v === "boolean" ? 0 : (v as string | number | null | undefined));

function requireFields(fields: Field[], values: Values, errors: string[]) {
  for (const f of fields) {
    if (!f.required) continue;
    if (f.showIf && !f.showIf.values.includes(str(values[f.showIf.field]))) continue;
    const v = values[f.name];
    const missing = f.type === "attachment" ? !att(v) : f.type === "money" ? !(cents(v) > 0) : !str(v);
    if (missing) errors.push(`${f.label} is required.`);
  }
}

const dateField: Field = { name: "date", label: "Date", type: "date", required: true };

const popUpSales: Template = {
  number: 5,
  name: "Pop-up & Event Sales",
  roles: ENCODERS,
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
    requireFields(this.fields, v, errors);
    const cash = cashAccountsFor(ctx.profitCenter);
    const channel = str(v.channel);
    const target = channel === "cash" ? cash.forDeposit : channel === "gcash" ? cash.gcash : cash.cardClearing;
    const sales = channel === "cash" ? ACCOUNTS.popupCash : channel === "gcash" ? ACCOUNTS.popupGcash : ACCOUNTS.popupCard;
    if (channel === "gcash" && !target) errors.push(`${ctx.profitCenter}'s GCash account is not set up yet.`);
    const amount = cents(v.amount);
    const discounts = cents(v.discounts);
    if (discounts > 0 && !str(v.discountAccount)) errors.push("Choose the discount type.");
    const event = str(v.event);
    const pc = { profit_center: ctx.profitCenter };
    return {
      errors,
      entry: finishEntry({
        kind: "Template",
        transaction_type: 5,
        book: "Store",
        profit_center: ctx.profitCenter,
        entry_date: str(v.date),
        description: `Pop-up sales: ${event}`,
        attachments: att(v.proof) ? [att(v.proof)!] : [],
        lines: [
          debit(target ?? "", amount, "5.receipt"),
          debit(str(v.discountAccount) || ACCOUNTS.discountPromo, discounts, "5.discounts", pc),
          credit(sales, amount + discounts, "5.sales", { ...pc, party_name: event, memo: event }),
        ],
      }),
    };
  },
};

const cardPayout: Template = {
  number: 7,
  name: "Card Payout",
  roles: OWNERS_ACCOUNTANT,
  batchApproval: true,
  fields: [
    dateField,
    { name: "gross", label: "Card sales cleared (gross)", type: "money", required: true },
    { name: "fees", label: "Card fees deducted", type: "money" },
    { name: "reference", label: "Bank credit reference", type: "text", required: true },
    { name: "proof", label: "Bank statement / payout notice", type: "attachment" },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, errors);
    const cash = cashAccountsFor(ctx.profitCenter);
    if (!cash.bank) errors.push(`${ctx.profitCenter}'s bank account is not set up yet.`);
    const gross = cents(v.gross);
    const fees = cents(v.fees);
    if (fees > gross) errors.push("Fees can't be more than the gross amount.");
    return {
      errors,
      entry: finishEntry({
        kind: "Template",
        transaction_type: 7,
        book: "Store",
        profit_center: ctx.profitCenter,
        entry_date: str(v.date),
        description: `Card payout, net ${formatPeso(gross - fees)}`,
        source_document: str(v.reference),
        attachments: att(v.proof) ? [att(v.proof)!] : [],
        lines: [
          debit(cash.bank ?? "", gross - fees, "7.bank"),
          debit(ACCOUNTS.cardFees, fees, "7.fees", { profit_center: ctx.profitCenter }),
          credit(cash.cardClearing, gross, "7.clearing"),
        ],
      }),
    };
  },
};

const platformPayout: Template = {
  number: 8,
  name: "Grab / Foodpanda Payout",
  roles: OWNERS_ACCOUNTANT,
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
    {
      name: "receivedIn",
      label: "Received in",
      type: "select",
      required: true,
      options: [
        { value: "bank", label: "Bank" },
        { value: "gcash", label: "GCash" },
      ],
    },
    { name: "gross", label: "Sales cleared (gross, at menu price)", type: "money", required: true },
    { name: "commission", label: "Commission", type: "money" },
    { name: "deductions", label: "Penalties and adjustments", type: "money" },
    { name: "withholding", label: "Tax withheld", type: "money" },
    { name: "reference", label: "Statement / payout reference", type: "text", required: true },
    { name: "proof", label: "Weekly platform statement", type: "attachment", required: true },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, errors);
    const cash = cashAccountsFor(ctx.profitCenter);
    const grab = str(v.platform) === "Grab";
    const receiving = str(v.receivedIn) === "gcash" ? cash.gcash : cash.bank;
    if (!receiving) errors.push(`${ctx.profitCenter}'s ${str(v.receivedIn) === "gcash" ? "GCash" : "bank"} account is not set up yet.`);
    const gross = cents(v.gross);
    const commission = cents(v.commission);
    const deductions = cents(v.deductions);
    const withholding = cents(v.withholding);
    const net = gross - commission - deductions - withholding;
    if (net < 0) errors.push("Deductions can't be more than the gross amount.");
    const pc = { profit_center: ctx.profitCenter };
    return {
      errors,
      entry: finishEntry({
        kind: "Template",
        transaction_type: 8,
        book: "Store",
        profit_center: ctx.profitCenter,
        entry_date: str(v.date),
        description: `${str(v.platform)} payout, net ${formatPeso(net)}`,
        source_document: str(v.reference),
        attachments: att(v.proof) ? [att(v.proof)!] : [],
        lines: [
          debit(receiving ?? "", net, "8.received"),
          debit(grab ? ACCOUNTS.commissionGrab : ACCOUNTS.commissionFoodpanda, commission, "8.commission", pc),
          debit(grab ? ACCOUNTS.deductionsGrab : ACCOUNTS.deductionsFoodpanda, deductions, "8.deductions", pc),
          debit(ACCOUNTS.creditableWithholdingTax, withholding, "8.cwt", { party_name: str(v.platform) }),
          credit(grab ? cash.grabClearing : cash.foodpandaClearing, gross, "8.clearing"),
        ],
      }),
    };
  },
};

const cashDeposit: Template = {
  number: 9,
  name: "Cash Deposit",
  roles: OWNERS_ACCOUNTANT,
  batchApproval: true,
  fields: [
    dateField,
    { name: "amount", label: "Amount deposited", type: "money", required: true },
    { name: "reference", label: "Deposit slip number", type: "text", required: true },
    { name: "proof", label: "Deposit slip photo", type: "attachment", required: true },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, errors);
    const cash = cashAccountsFor(ctx.profitCenter);
    if (!cash.bank) errors.push(`${ctx.profitCenter}'s bank account is not set up yet.`);
    const amount = cents(v.amount);
    return {
      errors,
      entry: finishEntry({
        kind: "Template",
        transaction_type: 9,
        book: "Store",
        profit_center: ctx.profitCenter,
        entry_date: str(v.date),
        description: `Cash deposit ${formatPeso(amount)}`,
        source_document: str(v.reference),
        attachments: att(v.proof) ? [att(v.proof)!] : [],
        lines: [debit(cash.bank ?? "", amount, "9.bank"), credit(cash.forDeposit, amount, "9.cash")],
      }),
    };
  },
};

function transferOptions(pc: "GGC" | "The Nest") {
  const cash = cashAccountsFor(pc);
  return [
    { value: cash.forDeposit, label: `${cash.forDeposit} Cash on Hand – For Deposit` },
    { value: cash.pettyCash, label: `${cash.pettyCash} Petty Cash – Cashier` },
    ...(cash.bank ? [{ value: cash.bank, label: `${cash.bank} Bank` }] : []),
    ...(cash.gcash ? [{ value: cash.gcash, label: `${cash.gcash} GCash` }] : []),
    ...(pc === "GGC" ? [{ value: "1170", label: "1170 Cash in Bank – GoTyme" }] : []),
  ];
}

const transfer: Template = {
  number: 10,
  name: "Transfer Between Own Accounts",
  roles: OWNERS_ACCOUNTANT,
  batchApproval: true,
  fields: [
    dateField,
    { name: "from", label: "From (sending account)", type: "select", required: true, options: [] },
    { name: "to", label: "To (receiving account)", type: "select", required: true, options: [] },
    { name: "amount", label: "Amount", type: "money", required: true },
    { name: "fromReference", label: "Sending reference", type: "text", required: true },
    { name: "toReference", label: "Receiving reference", type: "text", required: true },
    { name: "proof", label: "Transfer receipt", type: "attachment" },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, errors);
    const allowed = transferOptions(ctx.profitCenter).map((o) => o.value);
    const from = str(v.from);
    const to = str(v.to);
    if (from && !allowed.includes(from)) errors.push("Choose a valid sending account.");
    if (to && !allowed.includes(to)) errors.push("Choose a valid receiving account.");
    if (from && from === to) errors.push("Sending and receiving accounts must differ.");
    const amount = cents(v.amount);
    return {
      errors,
      entry: finishEntry({
        kind: "Template",
        transaction_type: 10,
        book: "Store",
        profit_center: ctx.profitCenter,
        entry_date: str(v.date),
        description: `Transfer ${from} → ${to}`,
        source_document: `${str(v.fromReference)} / ${str(v.toReference)}`,
        attachments: att(v.proof) ? [att(v.proof)!] : [],
        lines: [debit(to, amount, "10.receiving"), credit(from, amount, "10.sending")],
      }),
    };
  },
};

const pettyCashExpense: Template = {
  number: 11,
  name: "Petty Cash Expense",
  roles: ENCODERS,
  batchApproval: true,
  fields: [
    dateField,
    { name: "description", label: "What was bought", type: "text", required: true },
    { name: "account", label: "Expense line", type: "expenseAccount", required: true },
    { name: "amount", label: "Amount", type: "money", required: true },
    { name: "supplier", label: "Supplier / store", type: "text" },
    { name: "quantity", label: "Quantity", type: "number", help: "Required for ingredients" },
    { name: "unit", label: "Unit", type: "text", help: "Required for ingredients (kg, pcs, L…)" },
    { name: "unitPrice", label: "Unit price", type: "money", help: "Required for ingredients" },
    { name: "receipt", label: "Receipt photo", type: "attachment" },
    { name: "noReceiptApproved", label: "No receipt; ₱300 or less and approved by the Supervisor", type: "checkbox" },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, errors);
    const cash = cashAccountsFor(ctx.profitCenter);
    const account = ctx.accounts.get(str(v.account));
    const amount = cents(v.amount);
    if (str(v.account)) {
      if (!account || !isExpenseAccount(account)) errors.push("Choose an expense or ingredient account.");
      else {
        if (!bookAllowed(account, "Store")) errors.push(`${account.code} is not a Store account.`);
        if (!profitCenterAllowed(account, ctx.profitCenter)) errors.push(`${account.code} ${account.name} can't be tagged ${ctx.profitCenter}.`);
        if (needsQuantity(account) && (!(Number(v.quantity) > 0) || !str(v.unit) || !(cents(v.unitPrice) > 0))) {
          errors.push("Ingredients need quantity, unit and unit price.");
        }
      }
    }
    const receipt = att(v.receipt);
    let unsupported = false;
    if (!receipt) {
      if (amount > NO_RECEIPT_LIMIT_CENTS) errors.push("Over ₱300 needs a receipt photo.");
      else if (!v.noReceiptApproved) errors.push("Attach the receipt, or tick that the Supervisor approved it without one.");
      else unsupported = true;
    }
    const qty = account && needsQuantity(account);
    return {
      errors,
      entry: finishEntry({
        kind: "Template",
        transaction_type: 11,
        book: "Store",
        profit_center: ctx.profitCenter,
        entry_date: str(v.date),
        description: str(v.description),
        source_document: str(v.supplier) || null,
        unsupported,
        attachments: receipt ? [receipt] : [],
        lines: [
          debit(str(v.account), amount, "11.expense", {
            profit_center: ctx.profitCenter,
            party_name: str(v.supplier) || null,
            quantity: qty ? Number(v.quantity) : null,
            unit: qty ? str(v.unit) : null,
            unit_price: qty ? cents(v.unitPrice) / 100 : null,
            memo: str(v.description),
          }),
          credit(cash.pettyCash, amount, "11.petty_cash"),
        ],
      }),
    };
  },
};

export const TEMPLATES: Template[] = [popUpSales, cardPayout, platformPayout, cashDeposit, transfer, pettyCashExpense];

export function getTemplate(n: number): Template | undefined {
  return TEMPLATES.find((t) => t.number === n);
}

/** Fields with options that depend on the profit center (transfer accounts). */
export function fieldsFor(t: Template, pc: "GGC" | "The Nest"): Field[] {
  if (t.number !== 10) return t.fields;
  return t.fields.map((f) => (f.name === "from" || f.name === "to" ? { ...f, options: transferOptions(pc) } : f));
}

/** Template numbers the daily report creates, with their names (for the journal and approvals). */
export const TEMPLATE_NAMES: Record<number, string> = {
  1: "Daily Cash Sales",
  2: "Daily GCash Sales",
  3: "Daily Card Sales",
  4: "Daily Grab / Foodpanda Sales",
  5: "Pop-up & Event Sales",
  6: "Staff Food Charge",
  7: "Card Payout",
  8: "Grab / Foodpanda Payout",
  9: "Cash Deposit",
  10: "Transfer Between Own Accounts",
  11: "Petty Cash Expense",
  26: "Employee Cash Advance",
  39: "Unclassified Cash Movement",
};

export const DAILY_REPORT_ROLES: Role[] = ENCODERS;
