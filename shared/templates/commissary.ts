// Commissary and Store together: #19 Store pays a Commissary cost, #20 transfer billing,
// #21 monthly settlement. Each posts one entry in each book, approved together.

import { credit, debit } from "../entries";
import {
  ALL_BOOKS,
  attachmentsOf,
  cents,
  checkAccount,
  dateField,
  EXPENSE_COLUMNS,
  expenseLines,
  type Field,
  formatPeso,
  makeEntry,
  OWNERS_ACCOUNTANT,
  requireFields,
  result,
  rowsOf,
  str,
  type TemplateContext,
  type Template,
} from "./common";
import { profitCenterAllowed } from "../accounts";
import { toCents } from "../money";

export const DUE_FROM_STORE = "1280";
export const DUE_TO_COMMISSARY = "2180";
export const MARIBANK = "1145";
export const TRANSFER_BILLINGS = "4190";

const commissaryCtx = (ctx: TemplateContext): TemplateContext => ({ ...ctx, book: "Commissary", profitCenter: "GGC" });
const COMMISSARY_EXPENSE_COLUMNS: Field[] = EXPENSE_COLUMNS.filter((c) => c.name !== "profitCenter").map((c) =>
  c.name === "account" ? { ...c, label: "Commissary expense line", book: "Commissary" } : c,
);

export const storePaysCommissaryCost: Template = {
  number: 19,
  name: "Store Pays a Commissary Cost",
  group: "Commissary",
  roles: [...OWNERS_ACCOUNTANT, "Supervisor", "Commissary In-charge"],
  books: ALL_BOOKS,
  twoBook: true,
  batchApproval: true,
  fields: [
    dateField,
    { name: "description", label: "What was paid for", type: "text", required: true },
    { name: "paidFrom", label: "Store paid from", type: "account", filter: "payFrom", book: "Store", required: true },
    { name: "lines", label: "Commissary items", type: "rows", required: true, columns: COMMISSARY_EXPENSE_COLUMNS },
    { name: "receipt", label: "Receipt photo", type: "attachment", required: true },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const store = { ...ctx, book: "Store" as const };
    checkAccount(str(v.paidFrom), "payFrom", "Store paid from", store, errors);
    const { lines, totalCents } = expenseLines(rowsOf(v.lines), commissaryCtx(ctx), errors, "19.expense");
    const description = str(v.description);
    const attachments = attachmentsOf(v.receipt);
    return result(
      errors,
      makeEntry(store, v, 19, `Paid for the Commissary: ${description}`, [debit(DUE_TO_COMMISSARY, totalCents, "19.due_to"), credit(str(v.paidFrom), totalCents, "19.paid")], {
        attachments,
      }),
      makeEntry(commissaryCtx(ctx), v, 19, `Paid by the Store: ${description}`, [...lines, credit(DUE_FROM_STORE, totalCents, "19.due_from")], {
        attachments,
      }),
    );
  },
};

export const transferBilling: Template = {
  number: 20,
  name: "Commissary Transfer Billing",
  group: "Commissary",
  roles: [...OWNERS_ACCOUNTANT, "Commissary In-charge"],
  books: ALL_BOOKS,
  twoBook: true,
  batchApproval: true,
  fields: [
    dateField,
    {
      name: "billedTo",
      label: "Billed to",
      type: "select",
      required: true,
      options: [
        { value: "GGC", label: "Store – GGC" },
        { value: "The Nest", label: "Store – The Nest" },
      ],
    },
    { name: "reference", label: "Delivery slip number", type: "text", required: true },
    {
      name: "lines",
      label: "Products",
      type: "rows",
      required: true,
      columns: [
        { name: "product", label: "Product", type: "product", required: true },
        { name: "quantity", label: "Quantity", type: "number", required: true },
        { name: "unitPrice", label: "Transfer price", type: "money", required: true },
      ],
    },
    { name: "slip", label: "Delivery slip photo", type: "attachment", required: true },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const billedTo = str(v.billedTo) === "The Nest" ? "The Nest" : "GGC";
    const commissaryLines = [];
    const storeLines = [];
    let total = 0;
    for (const [i, row] of rowsOf(v.lines).entries()) {
      const product = ctx.products?.get(str(row.product));
      const qty = Number(row.quantity);
      const price = cents(row.unitPrice);
      const amount = toCents((qty * price) / 100);
      if (!product || !product.active) {
        errors.push(`Line ${i + 1}: choose a product.`);
        continue;
      }
      const cogs = ctx.accounts.get(product.cogsAccount);
      if (!cogs || cogs.type !== "COGS" || !cogs.active) {
        errors.push(`Line ${i + 1}: ${product.name} has no valid COGS account in Airtable (Commissary Products).`);
      } else if (!profitCenterAllowed(cogs, billedTo)) {
        errors.push(`Line ${i + 1}: ${product.name} posts to ${cogs.code} ${cogs.name}, which can't be tagged ${billedTo}.`);
      }
      total += amount;
      const detail = { quantity: qty, unit: product.unit, unit_price: price / 100, memo: product.name };
      commissaryLines.push(credit(TRANSFER_BILLINGS, amount, "20.billing", { ...detail, profit_center: "GGC", party_name: product.name }));
      storeLines.push(debit(product.cogsAccount, amount, "20.cogs", { ...detail, profit_center: billedTo }));
    }
    const attachments = attachmentsOf(v.slip);
    const source_document = str(v.reference);
    return result(
      errors,
      makeEntry(commissaryCtx(ctx), v, 20, `Transfer billing to ${billedTo} (${formatPeso(total)})`, [debit(DUE_FROM_STORE, total, "20.due_from"), ...commissaryLines], {
        attachments,
        source_document,
      }),
      makeEntry({ ...ctx, book: "Store", profitCenter: billedTo }, v, 20, `Commissary transfer (${formatPeso(total)})`, [...storeLines, credit(DUE_TO_COMMISSARY, total, "20.due_to")], {
        attachments,
        source_document,
      }),
    );
  },
};

export const commissarySettlement: Template = {
  number: 21,
  name: "Monthly Commissary Settlement",
  group: "Commissary",
  roles: OWNERS_ACCOUNTANT,
  books: ALL_BOOKS,
  twoBook: true,
  batchApproval: true,
  fields: [
    dateField,
    { name: "amount", label: "Amount transferred to MariBank", type: "money", required: true, help: "Must clear the full Due to Commissary balance" },
    { name: "paidFrom", label: "Store paid from", type: "account", filter: "bank", book: "Store", required: true },
    { name: "reference", label: "Transfer reference", type: "text", required: true },
    { name: "proof", label: "Transfer receipt", type: "attachment" },
  ],
  build(v, ctx) {
    const errors: string[] = [];
    requireFields(this.fields, v, ctx, errors);
    const store = { ...ctx, book: "Store" as const };
    checkAccount(str(v.paidFrom), "bank", "Store paid from", store, errors);
    const amount = cents(v.amount);
    if (ctx.dueToCommissaryCents !== undefined && amount !== ctx.dueToCommissaryCents) {
      errors.push(`The settlement clears the full balance: Due to Commissary is ${formatPeso(ctx.dueToCommissaryCents)} (approved entries).`);
    }
    const extra = { attachments: attachmentsOf(v.proof), source_document: str(v.reference) };
    return result(
      errors,
      makeEntry(store, v, 21, "Monthly settlement to the Commissary", [debit(DUE_TO_COMMISSARY, amount, "21.due_to"), credit(str(v.paidFrom), amount, "21.paid")], extra),
      makeEntry(commissaryCtx(ctx), v, 21, "Monthly settlement from the Store", [debit(MARIBANK, amount, "21.maribank"), credit(DUE_FROM_STORE, amount, "21.due_from")], extra),
    );
  },
};
