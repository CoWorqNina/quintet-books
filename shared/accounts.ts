import { isInventoryCategory } from "./inventory";
import type { Account, Book, ProfitCenter } from "./types";

// Fixed accounts the Section 7 templates post to, per profit center. The Nest keeps its own
// cash, GCash and clearing accounts. Banks are chosen freely when money is deposited or paid out
// (one consolidated Balance Sheet), so they are not fixed here.
export const CASH_ACCOUNTS: Record<
  "GGC" | "The Nest",
  {
    forDeposit: string;
    pettyCash: string;
    gcash: string | null;
    cardClearing: string;
    grabClearing: string;
    foodpandaClearing: string;
  }
> = {
  GGC: {
    forDeposit: "1110",
    pettyCash: "1120",
    gcash: "1150",
    cardClearing: "1181",
    grabClearing: "1182",
    foodpandaClearing: "1183",
  },
  "The Nest": {
    forDeposit: "1156",
    pettyCash: "1157",
    gcash: "1158",
    cardClearing: "1184",
    grabClearing: "1185",
    foodpandaClearing: "1186",
  },
};

export const ACCOUNTS = {
  salesCash: "4100",
  salesGcash: "4110",
  salesCard: "4120",
  salesFoodpanda: "4130",
  salesGrab: "4140",
  popupCash: "4161",
  popupGcash: "4162",
  popupCard: "4163",
  salesStaffCharges: "4170",
  salesRefunds: "4183",
  discountScPwd: "4181",
  discountPromo: "4182",
  receivableShortages: "1241",
  receivableAdvances: "1242",
  receivableFoodCharges: "1243",
  ownerFoodAllowance: "6135",
  receivableOwnerFood: "1255",
  creditableWithholdingTax: "1270",
  suspense: "1195",
  commissionGrab: "6551",
  commissionFoodpanda: "6552",
  deductionsGrab: "6553",
  deductionsFoodpanda: "6554",
  cardFees: "6555",
  cashOverShort: "7140",
  inventoryAdjustment: "5199",
} as const;

export const DISCOUNT_ACCOUNTS = [ACCOUNTS.discountScPwd, ACCOUNTS.discountPromo] as const;

/**
 * Accounts a purchase line ("expense line") may use: a postable COGS or operating expense
 * account. Ingredients are expensed to their cost of sales account when bought (Raw Chicken,
 * Fries, Sauces…); the month-end count then adjusts each inventory category to what's on hand.
 * Inventory Adjustment and the merged Marinate account aren't picked by hand.
 */
export function isExpenseAccount(a: Account): boolean {
  if (!a.active || a.isHeader) return false;
  if (a.code === ACCOUNTS.inventoryAdjustment || a.code === MERGED_MARINATE) return false;
  return a.type === "COGS" || a.type === "Operating Expense";
}

/** 5120 Marinate was merged into 5110 Breading & Marinate. */
const MERGED_MARINATE = "5120";

/** Ingredient purchases (inventory categories and COGS, except Inventory Adjustment) carry quantity, unit and unit price. */
export function needsQuantity(a: Account): boolean {
  return isInventoryCategory(a.code) || (a.type === "COGS" && a.code !== ACCOUNTS.inventoryAdjustment);
}

/** Whether an account may be tagged with this profit center, per its Chart of Accounts rule. */
export function profitCenterAllowed(a: Account, pc: ProfitCenter): boolean {
  switch (a.profitCenterRule) {
    case "GGC":
      return pc === "GGC";
    case "The Nest":
      return pc === "The Nest";
    case "Shared":
      return pc === "Shared";
    case "Per asset (GGC, The Nest or Shared)":
      return true;
    default:
      return pc !== "Shared";
  }
}

export function bookAllowed(a: Account, book: "Store" | "Commissary"): boolean {
  return a.book === "Both" || a.book === book;
}

export function cashAccountsFor(pc: ProfitCenter) {
  if (pc === "Shared") throw new Error("Cash accounts belong to GGC or The Nest");
  return CASH_ACCOUNTS[pc];
}

/** Drawer cash; every other active cash account is a bank or e-wallet. */
export const CASH_ON_HAND = new Set(["1110", "1120", "1156", "1157"]);
/** Cash on hand – For Deposit (GGC, The Nest): payments can also be made from it. */
export const CASH_FOR_DEPOSIT = new Set(["1110", "1156"]);

/** Accounts money can be deposited into or paid out to: any active Store bank or e-wallet. */
export function isBankAccount(a: Account | undefined): a is Account {
  return !!a && a.active && !a.isHeader && a.isCashAccount && !CASH_ON_HAND.has(a.code) && bookAllowed(a, "Store");
}

/** Any active Store cash account, on hand or in a bank (for transfers between own accounts). */
export function isStoreCashAccount(a: Account | undefined): a is Account {
  return !!a && a.active && !a.isHeader && a.isCashAccount && bookAllowed(a, "Store");
}

/** Headers for owners' SPayLater (2160) and credit card (2190) accounts used to pay suppliers. */
export const CARDS_PAYABLE = ["2160", "2190"];
/** Reimbursements payable per person (owners' own cash). */
export const REIMBURSEMENTS = "2110";

/** An owner's credit card or SPayLater account. */
export function isCardAccount(a: Account | undefined): boolean {
  return !!a && CARDS_PAYABLE.includes(a.parentCode ?? "");
}

export type AccountFilter =
  | "expense" // COGS or operating expense ("expense line")
  | "bank" // bank or e-wallet in the book
  | "payFrom" // bank, e-wallet or the profit center's petty cash
  | "receiveInto" // bank, e-wallet or cash on hand
  | "cash" // any cash account in the book
  | "reimbursement" // Reimbursements Payable per person (2111-2114)
  | "card" // owners' SPayLater and credit cards (2160, 2190)
  | "payable" // a card, SPayLater or reimbursement account (bills paid with #18)
  | "payment" // bank, e-wallet, or cash on hand for deposit (paying a bill)
  | "bankOrCard" // bank, e-wallet, cash for deposit, or an owner's card / SPayLater
  | "payFromOrCard" // payFrom, or an owner's card / SPayLater
  | "ppe" // property & equipment classes
  | "deposit" // refundable deposits
  | "employeeReceivable" // 1241-1244
  | "grossPay" // salaries and Steph's payroll
  | "loan" // loans payable to lenders
  | "interest" // interest expense per loan (7510-7530)
  | "postable"; // any active, non-header account in the book

export interface FilterContext {
  book: Book;
  profitCenter: "GGC" | "The Nest";
}

export const GROSS_PAY_ACCOUNTS = ["6100", "6105", "6110", "6510"];

export function accountMatches(filter: AccountFilter, a: Account | undefined, ctx: FilterContext): a is Account {
  if (!a || !a.active || a.isHeader || !bookAllowed(a, ctx.book)) return false;
  const cash = ctx.book === "Store" ? cashAccountsFor(ctx.profitCenter) : null;
  switch (filter) {
    case "expense":
      return isExpenseAccount(a) && profitCenterAllowed(a, ctx.book === "Commissary" ? "GGC" : ctx.profitCenter);
    case "bank":
      return a.isCashAccount && !CASH_ON_HAND.has(a.code);
    case "payFrom":
      return (a.isCashAccount && !CASH_ON_HAND.has(a.code)) || a.code === cash?.pettyCash;
    case "receiveInto":
      return a.isCashAccount && (!CASH_ON_HAND.has(a.code) || a.code === cash?.forDeposit || a.code === cash?.pettyCash);
    case "cash":
      return a.isCashAccount;
    case "reimbursement":
      return a.parentCode === REIMBURSEMENTS;
    case "card":
      return isCardAccount(a);
    case "payable":
      return a.parentCode === REIMBURSEMENTS || isCardAccount(a);
    case "payment":
      return (a.isCashAccount && !CASH_ON_HAND.has(a.code)) || CASH_FOR_DEPOSIT.has(a.code);
    case "bankOrCard":
      return (a.isCashAccount && !CASH_ON_HAND.has(a.code)) || CASH_FOR_DEPOSIT.has(a.code) || isCardAccount(a);
    case "payFromOrCard":
      return (a.isCashAccount && !CASH_ON_HAND.has(a.code)) || a.code === cash?.pettyCash || isCardAccount(a);
    case "ppe":
      // 1550 Smallwares (legacy) takes no new additions from Nov 1, 2026
      return a.parentCode === "1500" && a.type === "Asset" && a.code !== "1550";
    case "interest":
      return a.parentCode === "7500";
    case "deposit":
      return a.parentCode === "1400" && a.code !== "1430";
    case "employeeReceivable":
      return a.parentCode === "1240";
    case "grossPay":
      return GROSS_PAY_ACCOUNTS.includes(a.code);
    case "loan":
      return a.parentCode === "2200" && a.type === "Liability" && a.code !== "2250" && a.code !== "2260";
    case "postable":
      return true;
  }
}

/** Accumulated depreciation account for each Property & Equipment class. */
export const ACCUMULATED_DEPRECIATION: Record<string, string> = {
  "1510": "1591",
  "1520": "1592",
  "1530": "1593",
  "1540": "1594",
  "1550": "1595",
  "1560": "1596",
};

/** Useful lives set by management, in months (renovation 2 years, equipment 1.5, furniture 2). */
export const DEFAULT_LIFE_MONTHS: Record<string, number> = { "1510": 24, "1520": 18, "1530": 18, "1540": 24 };
