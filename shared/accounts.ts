import type { Account, ProfitCenter } from "./types";

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
  discountScPwd: "4181",
  discountPromo: "4182",
  receivableShortages: "1241",
  receivableAdvances: "1242",
  receivableFoodCharges: "1243",
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

/** Accounts an "expense line" may use: active, postable COGS or operating expense accounts. */
export function isExpenseAccount(a: Account): boolean {
  return a.active && !a.isHeader && (a.type === "COGS" || a.type === "Operating Expense");
}

/** Purchases of every COGS account except Inventory Adjustment carry quantity, unit and unit price. */
export function needsQuantity(a: Account): boolean {
  return a.type === "COGS" && a.code !== ACCOUNTS.inventoryAdjustment;
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

/** Accounts money can be deposited into or paid out to: any active Store bank or e-wallet. */
export function isBankAccount(a: Account | undefined): a is Account {
  return !!a && a.active && !a.isHeader && a.isCashAccount && !CASH_ON_HAND.has(a.code) && bookAllowed(a, "Store");
}

/** Any active Store cash account, on hand or in a bank (for transfers between own accounts). */
export function isStoreCashAccount(a: Account | undefined): a is Account {
  return !!a && a.active && !a.isHeader && a.isCashAccount && bookAllowed(a, "Store");
}
