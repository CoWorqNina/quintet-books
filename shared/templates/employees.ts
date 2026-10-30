// Employee receivables outside the daily report: #26 cash advance, #27 collection, #28 write-off.

import { ACCOUNTS } from "../accounts";
import { credit, debit } from "../entries";
import {
  ALL_BOOKS,
  attachmentsOf,
  cents,
  checkAccount,
  checkParty,
  dateField,
  makeEntry,
  OWNERS_ACCOUNTANT,
  partyExtras,
  requireFields,
  result,
  STORE,
  str,
  type Template,
} from "./common";

const employeeField = { name: "employee", label: "Employee", type: "party", partyType: "Employee", required: true } as const;

export const employeeAdvance: Template = {
  number: 26,
  name: "Employee Cash Advance",
  group: "Employees",
  roles: [...OWNERS_ACCOUNTANT, "Supervisor"],
  books: ALL_BOOKS,
  batchApproval: true,
  fields: [
    dateField,
    employeeField,
    { name: "amount", label: "Amount", type: "money", required: true },
    { name: "paidFrom", label: "Paid from", type: "account", filter: "payFrom", required: true },
    { name: "proof", label: "Signed acknowledgment", type: "attachment", required: true },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const employee = checkParty(str(v.employee), "Employee", "Employee", ctx, errors);
    checkAccount(str(v.paidFrom), "payFrom", "Paid from", ctx, errors);
    const amount = cents(v.amount);
    return result(
      errors,
      makeEntry(
        ctx,
        v,
        26,
        `Cash advance: ${employee?.name ?? ""}`,
        [debit(ACCOUNTS.receivableAdvances, amount, "26.receivable", partyExtras(employee)), credit(str(v.paidFrom), amount, "26.paid")],
        { attachments: attachmentsOf(v.proof) },
      ),
    );
  },
};

export const receivableCollected: Template = {
  number: 27,
  name: "Employee Receivable Collected (outside payroll)",
  group: "Employees",
  roles: [...OWNERS_ACCOUNTANT, "Supervisor"],
  books: ALL_BOOKS,
  batchApproval: true,
  fields: [
    dateField,
    employeeField,
    { name: "receivable", label: "For", type: "account", filter: "employeeReceivable", required: true },
    { name: "amount", label: "Amount collected", type: "money", required: true },
    { name: "receivedInto", label: "Received into", type: "account", filter: "receiveInto", required: true },
    { name: "proof", label: "Receipt", type: "attachment", required: true },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const employee = checkParty(str(v.employee), "Employee", "Employee", ctx, errors);
    checkAccount(str(v.receivable), "employeeReceivable", "For", ctx, errors);
    checkAccount(str(v.receivedInto), "receiveInto", "Received into", ctx, errors);
    const amount = cents(v.amount);
    return result(
      errors,
      makeEntry(
        ctx,
        v,
        27,
        `Collected from ${employee?.name ?? "employee"}`,
        [debit(str(v.receivedInto), amount, "27.received"), credit(str(v.receivable), amount, "27.receivable", partyExtras(employee))],
        { attachments: attachmentsOf(v.proof) },
      ),
    );
  },
};

export const shortageWriteOff: Template = {
  number: 28,
  name: "Shortage Write-off",
  group: "Employees",
  roles: OWNERS_ACCOUNTANT,
  books: STORE,
  batchApproval: false,
  fields: [
    dateField,
    employeeField,
    { name: "amount", label: "Shortage written off", type: "money", required: true },
    { name: "reason", label: "Why it won't be collected", type: "text", required: true },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const employee = checkParty(str(v.employee), "Employee", "Employee", ctx, errors);
    const amount = cents(v.amount);
    return result(
      errors,
      makeEntry(
        ctx,
        v,
        28,
        `Shortage written off: ${employee?.name ?? ""}. ${str(v.reason)}`,
        [
          debit(ACCOUNTS.cashOverShort, amount, "28.over_short", { profit_center: ctx.profitCenter }),
          credit(ACCOUNTS.receivableShortages, amount, "28.receivable", partyExtras(employee)),
        ],
      ),
    );
  },
};
