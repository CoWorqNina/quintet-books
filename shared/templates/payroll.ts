// Payroll (computed outside the app, entered as one summary per pay period per book):
// #22 accrual on the coverage end date, #23 payment, #24 remittances, #25 13th month.

import { credit, debit, type LineDraft } from "../entries";
import { sumCents } from "../money";
import {
  ALL_BOOKS,
  attachmentsOf,
  cents,
  checkAccount,
  checkParty,
  dateField,
  formatPeso,
  linePc,
  makeEntry,
  OWNERS_ACCOUNTANT,
  partyExtras,
  requireFields,
  result,
  rowsOf,
  str,
  type Template,
} from "./common";

export const PAYROLL = {
  salariesPayable: "2130",
  thirteenthPayable: "2135",
  sss: "2141",
  philhealth: "2142",
  pagibig: "2143",
  withholding: "2155",
  employerContributions: "6120",
} as const;

/** Payroll is recorded on the coverage end date: the 15th or the last day of the month. */
export function isCoverageEnd(date: string): boolean {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return d.getUTCDate() === 15 || d.getUTCDate() === last;
}

export const payrollAccrual: Template = {
  number: 22,
  name: "Payroll Accrual (15th and month-end)",
  group: "Payroll",
  roles: OWNERS_ACCOUNTANT,
  books: ALL_BOOKS,
  batchApproval: true,
  fields: [
    { ...dateField, label: "Coverage end date (15th or month-end)" },
    {
      name: "gross",
      label: "Gross pay",
      type: "rows",
      required: true,
      help: "One line per salary account and profit center. Steph's pay goes to Marketing – Steph's Payroll.",
      columns: [
        { name: "account", label: "Salary account", type: "account", filter: "grossPay", required: true },
        { name: "profitCenter", label: "Profit center", type: "profitCenter", storeOnly: true },
        { name: "amount", label: "Gross pay", type: "money", required: true },
      ],
    },
    { name: "sssEr", label: "SSS – employer share", type: "money" },
    { name: "philhealthEr", label: "PhilHealth – employer share", type: "money" },
    { name: "pagibigEr", label: "Pag-IBIG – employer share", type: "money" },
    {
      name: "erNest",
      label: "Of the employer share, The Nest's part",
      type: "money",
      storeOnly: true,
      help: "The rest is tagged GGC",
    },
    { name: "sssEe", label: "SSS – employee share", type: "money" },
    { name: "philhealthEe", label: "PhilHealth – employee share", type: "money" },
    { name: "pagibigEe", label: "Pag-IBIG – employee share", type: "money" },
    { name: "withholding", label: "Withholding tax on compensation", type: "money", help: "Only if pay is above the taxable level" },
    {
      name: "deductions",
      label: "Deductions from pay (shortages, advances, food, damages)",
      type: "rows",
      columns: [
        { name: "employee", label: "Employee", type: "party", partyType: "Employee", required: true },
        { name: "receivable", label: "For", type: "account", filter: "employeeReceivable", required: true },
        { name: "amount", label: "Amount", type: "money", required: true },
      ],
    },
    { name: "summary", label: "Payroll summary", type: "attachment", required: true },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const date = str(v.date);
    if (date && !isCoverageEnd(date)) errors.push("Payroll is recorded on the 15th or the last day of the month.");

    const grossLines: LineDraft[] = rowsOf(v.gross).map((row, i) => {
      checkAccount(str(row.account), "grossPay", `Gross pay line ${i + 1}`, ctx, errors);
      return debit(str(row.account), cents(row.amount), "22.gross", { profit_center: linePc(ctx, row.profitCenter) });
    });
    const gross = sumCents(grossLines.map((l) => l.debitCents));

    const er = { sss: cents(v.sssEr), philhealth: cents(v.philhealthEr), pagibig: cents(v.pagibigEr) };
    const ee = { sss: cents(v.sssEe), philhealth: cents(v.philhealthEe), pagibig: cents(v.pagibigEe) };
    const erTotal = er.sss + er.philhealth + er.pagibig;
    const erNest = ctx.book === "Store" ? cents(v.erNest) : 0;
    if (erNest > erTotal) errors.push("The Nest's part can't be more than the employer share.");
    const withholding = cents(v.withholding);

    const deductionLines = rowsOf(v.deductions).map((row, i) => {
      const employee = checkParty(str(row.employee), "Employee", `Deduction ${i + 1}`, ctx, errors);
      checkAccount(str(row.receivable), "employeeReceivable", `Deduction ${i + 1}`, ctx, errors);
      return credit(str(row.receivable), cents(row.amount), "22.deduction", partyExtras(employee));
    });
    const deductions = sumCents(deductionLines.map((l) => l.creditCents));
    const net = gross - ee.sss - ee.philhealth - ee.pagibig - withholding - deductions;
    if (gross > 0 && net <= 0) errors.push(`Net pay would be ${formatPeso(net)}; check the deductions.`);

    return result(
      errors,
      makeEntry(
        ctx,
        v,
        22,
        `Payroll to ${date}: gross ${formatPeso(gross)}, net ${formatPeso(net)}`,
        [
          ...grossLines,
          debit(PAYROLL.employerContributions, erTotal - erNest, "22.employer", { profit_center: "GGC" }),
          debit(PAYROLL.employerContributions, erNest, "22.employer", { profit_center: "The Nest" }),
          credit(PAYROLL.sss, ee.sss + er.sss, "22.sss"),
          credit(PAYROLL.philhealth, ee.philhealth + er.philhealth, "22.philhealth"),
          credit(PAYROLL.pagibig, ee.pagibig + er.pagibig, "22.pagibig"),
          credit(PAYROLL.withholding, withholding, "22.withholding"),
          ...deductionLines,
          credit(PAYROLL.salariesPayable, net, "22.net"),
        ],
        { attachments: attachmentsOf(v.summary) },
      ),
    );
  },
};

export const payrollPayment: Template = {
  number: 23,
  name: "Payroll Payment (5th and 20th)",
  group: "Payroll",
  roles: OWNERS_ACCOUNTANT,
  books: ALL_BOOKS,
  batchApproval: true,
  fields: [
    dateField,
    { name: "period", label: "Pay period", type: "text", required: true, help: "e.g. Nov 1–15" },
    { name: "amount", label: "Net pay released", type: "money", required: true },
    { name: "paidFrom", label: "Paid from", type: "account", filter: "payFrom", required: true },
    { name: "proof", label: "Payroll / transfer proof", type: "attachment" },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    checkAccount(str(v.paidFrom), "payFrom", "Paid from", ctx, errors);
    const amount = cents(v.amount);
    return result(
      errors,
      makeEntry(ctx, v, 23, `Payroll paid: ${str(v.period)}`, [debit(PAYROLL.salariesPayable, amount, "23.payable"), credit(str(v.paidFrom), amount, "23.paid")], {
        source_document: str(v.period),
        attachments: attachmentsOf(v.proof),
      }),
    );
  },
};

export const contributionsRemittance: Template = {
  number: 24,
  name: "Contributions Remittance",
  group: "Payroll",
  roles: OWNERS_ACCOUNTANT,
  books: ALL_BOOKS,
  batchApproval: true,
  fields: [
    dateField,
    { name: "sss", label: "SSS", type: "money" },
    { name: "philhealth", label: "PhilHealth", type: "money" },
    { name: "pagibig", label: "Pag-IBIG", type: "money" },
    { name: "withholding", label: "Withholding tax on compensation", type: "money" },
    { name: "paidFrom", label: "Paid from", type: "account", filter: "bank", required: true },
    { name: "reference", label: "Covered month / reference", type: "text", required: true },
    { name: "proof", label: "Remittance proof", type: "attachment", required: true },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    checkAccount(str(v.paidFrom), "bank", "Paid from", ctx, errors);
    const parts = [
      debit(PAYROLL.sss, cents(v.sss), "24.sss"),
      debit(PAYROLL.philhealth, cents(v.philhealth), "24.philhealth"),
      debit(PAYROLL.pagibig, cents(v.pagibig), "24.pagibig"),
      debit(PAYROLL.withholding, cents(v.withholding), "24.withholding"),
    ];
    const total = sumCents(parts.map((l) => l.debitCents));
    if (!total) errors.push("Enter at least one amount remitted.");
    return result(
      errors,
      makeEntry(ctx, v, 24, `Contributions remitted: ${str(v.reference)}`, [...parts, credit(str(v.paidFrom), total, "24.paid")], {
        source_document: str(v.reference),
        attachments: attachmentsOf(v.proof),
      }),
    );
  },
};

export const thirteenthMonthPayment: Template = {
  number: 25,
  name: "13th Month Payment",
  group: "Payroll",
  roles: OWNERS_ACCOUNTANT,
  books: ALL_BOOKS,
  batchApproval: true,
  fields: [
    dateField,
    { name: "amount", label: "Total paid", type: "money", required: true },
    { name: "paidFrom", label: "Paid from", type: "account", filter: "bank", required: true },
    { name: "list", label: "Employee list", type: "attachment", required: true },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    checkAccount(str(v.paidFrom), "bank", "Paid from", ctx, errors);
    const amount = cents(v.amount);
    return result(
      errors,
      makeEntry(ctx, v, 25, "13th month pay", [debit(PAYROLL.thirteenthPayable, amount, "25.payable"), credit(str(v.paidFrom), amount, "25.paid")], {
        attachments: attachmentsOf(v.list),
      }),
    );
  },
};
