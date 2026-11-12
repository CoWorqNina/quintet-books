// #45 Reschedule a Payable: closes the ticked bills and opens a new schedule in their place
// (installments with their own due dates), optionally adding charges such as installment interest
// or a late fee. Also how a bill's due date or label is changed (one new installment).

import { credit, debit, type LineDraft } from "../entries";
import {
  ALL_BOOKS,
  cents,
  checkAccount,
  dateField,
  type Field,
  formatPeso,
  linePc,
  makeEntry,
  OWNERS_ACCOUNTANT,
  requireFields,
  result,
  rowsOf,
  settleLines,
  str,
  type Template,
} from "./common";

const billsField: Field = {
  name: "bills",
  label: "Bills to reschedule",
  type: "openItems",
  required: true,
  itemsAccountField: "account",
  help: "Tick the bill(s) to replace; lower the amount to reschedule only part of one",
};

export const reschedulePayable: Template = {
  number: 45,
  name: "Reschedule a Payable (installments, new due dates)",
  group: "Purchases",
  roles: OWNERS_ACCOUNTANT,
  books: ALL_BOOKS,
  batchApproval: false,
  fields: [
    dateField,
    { name: "account", label: "Payable", type: "account", filter: "billAccount", required: true },
    billsField,
    {
      name: "installments",
      label: "New schedule",
      type: "rows",
      required: true,
      totalLabel: "New schedule total",
      help: "One line per installment (or one line to change a bill's due date or label)",
      columns: [
        { name: "dueDate", label: "Due date", type: "date", required: true },
        { name: "amount", label: "Amount", type: "money", required: true },
        { name: "label", label: "Label", type: "text" },
      ],
    },
    {
      name: "charges",
      label: "Added charges (optional)",
      type: "rows",
      totalLabel: "Charges",
      help: "Installment interest, late fees, service fees… added to what's owed",
      columns: [
        { name: "account", label: "Charge to", type: "account", filter: "charge", required: true },
        { name: "description", label: "What", type: "text" },
        { name: "amount", label: "Amount", type: "money", required: true },
        { name: "profitCenter", label: "Profit center", type: "profitCenter", storeOnly: true },
      ],
    },
    { name: "reason", label: "Reason / reference", type: "text", help: "e.g. Converted to 6-month 0% installment, BDO ref 12345" },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const account = checkAccount(str(v.account), "billAccount", "Payable", ctx, errors);
    const closed = settleLines(billsField, v, ctx, errors, "45.closed");

    // The new bills carry the supplier / lender of the bills they replace.
    const parties = [...new Set(closed.lines.map((l) => l.party_id ?? l.party_name ?? ""))];
    if (parties.length > 1 && str(v.account) === "2100") errors.push("Reschedule one supplier's bills at a time.");
    const party = closed.lines[0] ? { party_id: closed.lines[0].party_id ?? null, party_name: closed.lines[0].party_name ?? null } : {};

    const chargeLines: LineDraft[] = rowsOf(v.charges)
      .filter((r) => str(r.account) || cents(r.amount))
      .map((r, i) => {
        checkAccount(str(r.account), "charge", `Charge ${i + 1}`, ctx, errors);
        const amount = cents(r.amount);
        if (amount <= 0) errors.push(`Charge ${i + 1}: enter the amount.`);
        return debit(str(r.account), amount, "45.charge", { profit_center: linePc(ctx, r.profitCenter), memo: str(r.description) || "Added charge" });
      });

    const rows = rowsOf(v.installments);
    const newBills = rows.map((r, i) => {
      const amount = cents(r.amount);
      if (amount <= 0) errors.push(`Installment ${i + 1}: enter the amount.`);
      if (!str(r.dueDate)) errors.push(`Installment ${i + 1}: enter the due date.`);
      const label = str(r.label) || `${account?.name ?? "Bill"} – installment ${i + 1} of ${rows.length}`;
      return credit(str(v.account), amount, "45.installment", { ...party, memo: label, due_date: str(r.dueDate) || null });
    });

    const owed = closed.totalCents + chargeLines.reduce((s, l) => s + l.debitCents, 0);
    const scheduled = newBills.reduce((s, l) => s + l.creditCents, 0);
    if (closed.lines.length && rows.length && owed !== scheduled) {
      errors.push(`The new schedule adds up to ${formatPeso(scheduled)}, but the bills plus charges are ${formatPeso(owed)}.`);
    }
    return result(
      errors,
      makeEntry(
        ctx,
        v,
        45,
        `${account?.name ?? "Payable"} rescheduled into ${rows.length} installment${rows.length === 1 ? "" : "s"} (${formatPeso(scheduled)})`,
        [...closed.lines, ...chargeLines, ...newBills],
        { source_document: str(v.reason) || null },
      ),
    );
  },
};
