import type { Role } from "../types";
import { bankCharges, cardPayout, cashDeposit, platformPayout, popUpSales, transfer, unclassifiedCash } from "./cash";
import { assetPurchase, prepaidPayment, refundableDeposit } from "./assets";
import type { Template } from "./common";
import { commissarySettlement, storePaysCommissaryCost, transferBilling } from "./commissary";
import { employeeAdvance, receivableCollected, shortageWriteOff } from "./employees";
import { loanInstallment, loanProceeds, ownerAdvanceReturned, ownerLoanRepayment, ownerMoneyIn, ownerMoneyOut } from "./loans";
import { contributionsRemittance, payrollAccrual, payrollPayment, thirteenthMonthPayment } from "./payroll";
import {
  advanceApplied,
  personalFundPurchase,
  pettyCashExpense,
  purchaseOnCredit,
  purchasePaid,
  reimbursementPaid,
  smallItem,
  supplierAdvance,
  supplierPayment,
} from "./purchases";

export * from "./common";

export const TEMPLATES: Template[] = [
  popUpSales,
  cardPayout,
  platformPayout,
  cashDeposit,
  transfer,
  pettyCashExpense,
  purchasePaid,
  purchaseOnCredit,
  supplierPayment,
  supplierAdvance,
  advanceApplied,
  personalFundPurchase,
  reimbursementPaid,
  employeeAdvance,
  receivableCollected,
  shortageWriteOff,
  smallItem,
  unclassifiedCash,
  bankCharges,
  storePaysCommissaryCost,
  transferBilling,
  commissarySettlement,
  payrollAccrual,
  payrollPayment,
  contributionsRemittance,
  thirteenthMonthPayment,
  assetPurchase,
  prepaidPayment,
  refundableDeposit,
  loanProceeds,
  loanInstallment,
  ownerMoneyIn,
  ownerLoanRepayment,
  ownerMoneyOut,
  ownerAdvanceReturned,
].sort((a, b) => a.number - b.number);

export function getTemplate(n: number): Template | undefined {
  return TEMPLATES.find((t) => t.number === n);
}

/** Section 7 names, for the journal and approvals (including entries made by the daily report). */
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
  12: "Purchase – Paid",
  13: "Purchase – On Credit",
  14: "Supplier Payment",
  15: "Supplier Advance",
  16: "Advance Applied on Delivery",
  17: "Personal-Fund Purchase",
  18: "Reimbursement Paid",
  19: "Store Pays a Commissary Cost",
  20: "Commissary Transfer Billing",
  21: "Monthly Commissary Settlement",
  22: "Payroll Accrual",
  23: "Payroll Payment",
  24: "Contributions Remittance",
  25: "13th Month Payment",
  26: "Employee Cash Advance",
  27: "Employee Receivable Collected",
  28: "Shortage Write-off",
  29: "Asset Purchase",
  30: "Small Item (under ₱3,000)",
  31: "Prepaid Payment",
  32: "Refundable Deposit Paid / Refunded",
  33: "Loan Proceeds",
  34: "Loan Installment",
  35: "Owner Money In",
  36: "Owner Loan Repayment",
  37: "Owner Money Out",
  38: "Owner Advance Returned",
  39: "Unclassified Cash Movement",
  40: "Bank Charges",
  43: "Opening Balances",
};

export const DAILY_REPORT_ROLES: Role[] = ["Owner", "Accountant", "Supervisor", "Staff"];

/** Templates this role can use in at least one of their books. */
export function templatesFor(role: Role, books: string[]): Template[] {
  return TEMPLATES.filter((t) => t.roles.includes(role) && t.books.some((b) => books.includes(b)));
}
