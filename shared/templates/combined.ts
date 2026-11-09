// #44 Combined Payment: one transfer paying several payables at once (e.g. everything on an
// owner's cards, SPayLater and card loans, paid to that owner).

import { credit, debit, type LineDraft } from "../entries";
import {
  ALL_BOOKS,
  attachmentsOf,
  type BuildResult,
  checkAccount,
  dateField,
  type Field,
  formatPeso,
  installmentsFor,
  makeEntry,
  OWNERS_ACCOUNTANT,
  requireFields,
  result,
  rowsOf,
  settleLines,
  str,
  type Template,
  otherSources,
  otherSourcesField,
  transferFeeField,
  transferFeeLines,
} from "./common";
import { ACCRUED_INTEREST } from "./loans";

export const combinedItems: Field = {
  name: "bills",
  label: "Payables paid",
  type: "openItems",
  required: true,
  itemsAll: true,
  help: "Tick everything this one transfer pays: card and SPayLater charges, supplier bills, reimbursements, loan installments",
};

export const combinedPayment: Template = {
  number: 44,
  name: "Combined Payment (several payables, one transfer)",
  group: "Purchases",
  roles: OWNERS_ACCOUNTANT,
  books: ALL_BOOKS,
  batchApproval: true,
  fields: [
    dateField,
    { name: "payTo", label: "Paid to", type: "text", required: true, help: "Who received the transfer, e.g. the owner whose cards and card loans this pays" },
    combinedItems,
    { name: "paidFrom", label: "Paid from", type: "account", filter: "payment", required: true, help: "A bank or e-wallet, or cash on hand for deposit" },
    transferFeeField,
    otherSourcesField,
    { name: "reference", label: "Transfer reference", type: "text" },
    { name: "proof", label: "Transfer proof", type: "attachment" },
  ],
  build(v, ctx): BuildResult {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const bank = checkAccount(str(v.paidFrom), "payment", "Paid from", ctx, errors);
    const fee = transferFeeLines(v, ctx, "44.fee", errors, bank);
    const rows = rowsOf(v.bills);
    // Bills: one line per bill, naming the bill it settles (part payments allowed).
    const billRows = rows.filter((r) => !r.installmentId);
    const bills = settleLines(combinedItems, { ...v, bills: billRows }, ctx, errors, "44.bill");
    // Loan installments: always the full scheduled amount, split from the schedule row.
    const due = installmentsFor(ctx);
    const picked = [...new Set(rows.filter((r) => r.installmentId).map((r) => Number(r.installmentId)))];
    const lines: LineDraft[] = [];
    const ids: number[] = [];
    for (const id of picked) {
      const inst = due.find((i) => i.id === id);
      if (!inst) {
        errors.push("A ticked loan installment is no longer unpaid; reload the list.");
        continue;
      }
      const earlier = due.filter((i) => i.loanId === inst.loanId && i.seq < inst.seq && !picked.includes(i.id));
      if (earlier.length) errors.push(`${inst.loanName}: pay installment ${earlier[0].seq} before ${inst.seq}.`);
      const principal = Math.round(inst.principal * 100);
      const interest = Math.round(inst.interest * 100);
      const accrued = inst.interestRecorded ? interest : 0;
      const memo = `${inst.loanName} – installment ${inst.seq} of ${inst.count}, due ${inst.dueDate}`;
      lines.push(
        debit(inst.accountCode, principal, "44.principal", { memo }),
        debit(ACCRUED_INTEREST, accrued, "44.accrued", { party_id: `loan:${inst.loanId}`, party_name: inst.loanName, memo }),
        debit(inst.interestAccount, interest - accrued, "44.interest", { profit_center: "GGC", memo }),
      );
      ids.push(inst.id);
    }
    const total = bills.totalCents + lines.reduce((s, l) => s + l.debitCents, 0);
    const count = bills.lines.length + ids.length;
    const split = otherSources(v, ctx, total, "44.paid", errors, str(v.paidFrom));
    if (!count && !errors.some((e) => e.startsWith(combinedItems.label))) errors.push(`${combinedItems.label} is required.`);
    const payTo = str(v.payTo);
    const entry = makeEntry(
      ctx,
      v,
      44,
      `Combined payment to ${payTo || "…"}: ${count} item${count === 1 ? "" : "s"} (${formatPeso(total)})`,
      [
        ...bills.lines,
        ...lines,
        ...fee.lines,
        ...split.feeLines,
        credit(str(v.paidFrom), split.mainCents + fee.feeCents, "44.paid", { party_name: payTo || null }),
        ...split.credits,
      ],
      { source_document: str(v.reference) || null, attachments: attachmentsOf(v.proof) },
    );
    return { ...result(errors, entry), register: ids.length ? { type: "loan_payments", data: { installment_ids: ids } } : undefined };
  },
};

