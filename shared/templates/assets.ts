// Assets, prepaids and deposits: #29 asset purchase (₱3,000 and up), #31 prepaid payment,
// #32 refundable deposit paid or refunded. #29 and #31 also create their schedule record.

import { ACCUMULATED_DEPRECIATION, DEFAULT_LIFE_MONTHS } from "../accounts";
import { credit, debit } from "../entries";
import {
  ALL_BOOKS,
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
  str,
  type BuildResult,
  type Template,
} from "./common";
import { CAPITALIZE_FROM_CENTS } from "./purchases";

const AP = "2100";
export const PREPAID_EXPENSES = "1430";
export const PREPAID_AMORTIZATION = "6823";

/** Whole calendar months from start to end, inclusive (Nov 1 - Oct 31 = 12). */
export function monthsCovered(start: string, end: string): number {
  const [y1, m1] = start.split("-").map(Number);
  const [y2, m2] = end.split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1) + 1;
}

export const assetPurchase: Template = {
  number: 29,
  name: "Asset Purchase (₱3,000 and up)",
  group: "Assets & prepaids",
  roles: [...OWNERS_ACCOUNTANT, "Supervisor", "Commissary In-charge"],
  books: ALL_BOOKS,
  batchApproval: false,
  fields: [
    dateField,
    { name: "name", label: "Asset", type: "text", required: true, help: "e.g. Double-basket fryer" },
    { name: "assetClass", label: "Asset class", type: "account", filter: "ppe", required: true },
    {
      name: "tag",
      label: "Depreciation tag",
      type: "select",
      required: true,
      storeOnly: true,
      options: [
        { value: "GGC", label: "GGC" },
        { value: "The Nest", label: "The Nest" },
        { value: "Shared", label: "Shared (both use it, can't be separated)" },
      ],
    },
    { name: "cost", label: "Full cost (all installments)", type: "money", required: true },
    { name: "paidNow", label: "Paid now", type: "money", help: "Leave blank if all on credit" },
    { name: "paidFrom", label: "Paid from", type: "account", filter: "payFrom" },
    { name: "supplier", label: "Supplier (for any unpaid balance)", type: "party", partyType: "Supplier" },
    { name: "inUseDate", label: "Date put to use", type: "date", required: true },
    { name: "life", label: "Useful life (months)", type: "number", help: "Equipment 18, furniture 24, renovation 24" },
    { name: "popup", label: "Purchased for pop-ups", type: "checkbox" },
    { name: "receipt", label: "Receipt / invoice", type: "attachment", required: true },
  ],
  build(v, ctx): BuildResult {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const assetClass = checkAccount(str(v.assetClass), "ppe", "Asset class", ctx, errors);
    const cost = cents(v.cost);
    const paidNow = Math.min(cents(v.paidNow), cost);
    const onCredit = cost - paidNow;
    if (cost && cost < CAPITALIZE_FROM_CENTS) errors.push(`${formatPeso(cost)} is under ₱3,000: record it as a Small Item (#30).`);
    if (paidNow > 0) checkAccount(str(v.paidFrom), "payFrom", "Paid from", ctx, errors);
    const supplier = onCredit > 0 ? checkParty(str(v.supplier), "Supplier", "Supplier", ctx, errors) : undefined;
    if (onCredit > 0 && !str(v.supplier)) errors.push(`Choose the supplier for the unpaid ${formatPeso(onCredit)}.`);

    // Renovation is always Shared; Commissary assets are GGC; otherwise as tagged.
    const tag = assetClass?.profitCenterRule === "Shared" ? "Shared" : ctx.book === "Commissary" ? "GGC" : str(v.tag) || ctx.profitCenter;
    const life = Number(v.life) || DEFAULT_LIFE_MONTHS[str(v.assetClass)] || 0;
    if (str(v.assetClass) && !life) errors.push("Enter the useful life in months.");
    if (str(v.inUseDate) && str(v.date) && str(v.inUseDate) < str(v.date)) errors.push("The asset can't be put to use before it was bought.");

    const name = str(v.name);
    const entry = makeEntry(
      ctx,
      v,
      29,
      `Asset: ${name}${v.popup ? " (purchased for pop-ups)" : ""}`,
      [
        debit(str(v.assetClass), cost, "29.asset", { party_name: name, memo: `Tag: ${tag}` }),
        credit(str(v.paidFrom), paidNow, "29.paid"),
        credit(AP, onCredit, "29.ap", partyExtras(supplier)),
      ],
      { attachments: attachmentsOf(v.receipt) },
    );
    return {
      ...result(errors, entry),
      register: {
        type: "asset",
        data: {
          name,
          book: ctx.book,
          account_code: str(v.assetClass),
          accum_account_code: ACCUMULATED_DEPRECIATION[str(v.assetClass)] ?? "",
          profit_center: tag,
          cost: cost / 100,
          acquired_date: str(v.date),
          in_use_date: str(v.inUseDate),
          useful_life_months: life,
          popup: !!v.popup,
        },
      },
    };
  },
};

export const prepaidPayment: Template = {
  number: 31,
  name: "Prepaid Payment (₱3,000 and up, more than one month)",
  group: "Assets & prepaids",
  roles: OWNERS_ACCOUNTANT,
  books: ALL_BOOKS,
  batchApproval: true,
  fields: [
    dateField,
    { name: "item", label: "What it covers", type: "text", required: true, help: "e.g. Business permit 2027, insurance" },
    { name: "amount", label: "Amount paid", type: "money", required: true },
    { name: "start", label: "Coverage starts", type: "date", required: true },
    { name: "end", label: "Coverage ends", type: "date", required: true },
    { name: "profitCenter", label: "Profit center", type: "profitCenter", storeOnly: true },
    { name: "paidFrom", label: "Paid from", type: "account", filter: "bank", required: true },
    { name: "proof", label: "Receipt / invoice", type: "attachment", required: true },
  ],
  build(v, ctx): BuildResult {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    checkAccount(str(v.paidFrom), "bank", "Paid from", ctx, errors);
    const amount = cents(v.amount);
    const months = str(v.start) && str(v.end) ? monthsCovered(str(v.start), str(v.end)) : 0;
    if (str(v.end) && str(v.end) < str(v.start)) errors.push("Coverage must end after it starts.");
    if (amount && amount < CAPITALIZE_FROM_CENTS) errors.push("Under ₱3,000 is expensed in the month paid, not spread.");
    if (months === 1) errors.push("A one-month payment is expensed, not spread.");
    const item = str(v.item);
    const pc = ctx.book === "Commissary" ? "GGC" : str(v.profitCenter) === "The Nest" ? "The Nest" : str(v.profitCenter) === "GGC" ? "GGC" : ctx.profitCenter;
    const entry = makeEntry(
      ctx,
      v,
      31,
      `Prepaid: ${item} (${months} months from ${str(v.start)})`,
      [debit(PREPAID_EXPENSES, amount, "31.prepaid", { party_name: item }), credit(str(v.paidFrom), amount, "31.paid")],
      { attachments: attachmentsOf(v.proof) },
    );
    return {
      ...result(errors, entry),
      register: {
        type: "spread",
        data: {
          kind: "Prepaid",
          name: item,
          book: ctx.book,
          asset_account: PREPAID_EXPENSES,
          expense_account: PREPAID_AMORTIZATION,
          profit_center: pc,
          total: amount / 100,
          start_month: `${str(v.start).slice(0, 7)}-01`,
          months,
        },
      },
    };
  },
};

export const refundableDeposit: Template = {
  number: 32,
  name: "Refundable Deposit Paid / Refunded",
  group: "Assets & prepaids",
  roles: OWNERS_ACCOUNTANT,
  books: ALL_BOOKS,
  batchApproval: true,
  fields: [
    dateField,
    {
      name: "direction",
      label: "Deposit",
      type: "select",
      required: true,
      options: [
        { value: "paid", label: "Paid (we gave a deposit)" },
        { value: "refunded", label: "Refunded to us" },
      ],
    },
    { name: "account", label: "Deposit account", type: "account", filter: "deposit", required: true },
    { name: "name", label: "Deposit for", type: "text", required: true, help: "e.g. Davao Light meter deposit" },
    { name: "amount", label: "Amount", type: "money", required: true },
    { name: "bank", label: "Bank / e-wallet", type: "account", filter: "bank", required: true },
    { name: "proof", label: "Agreement / receipt", type: "attachment", required: true },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    checkAccount(str(v.account), "deposit", "Deposit account", ctx, errors);
    checkAccount(str(v.bank), "bank", "Bank / e-wallet", ctx, errors);
    const amount = cents(v.amount);
    const name = str(v.name);
    const paid = str(v.direction) !== "refunded";
    const lines = paid
      ? [debit(str(v.account), amount, "32.deposit", { party_name: name }), credit(str(v.bank), amount, "32.bank")]
      : [debit(str(v.bank), amount, "32.bank"), credit(str(v.account), amount, "32.deposit", { party_name: name })];
    return result(errors, makeEntry(ctx, v, 32, `Deposit ${paid ? "paid" : "refunded"}: ${name}`, lines, { attachments: attachmentsOf(v.proof) }));
  },
};
