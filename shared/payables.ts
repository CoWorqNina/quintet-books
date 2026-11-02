// Payables planner: everything the business owes, by when it falls due, against cash on hand.

export type PayableKind = "supplier" | "card" | "spaylater" | "reimbursement" | "loan" | "other";

export const PAYABLE_KINDS: { kind: PayableKind; label: string }[] = [
  { kind: "supplier", label: "Suppliers" },
  { kind: "card", label: "Credit cards" },
  { kind: "spaylater", label: "SPayLater" },
  { kind: "reimbursement", label: "Reimbursements" },
  { kind: "loan", label: "Loans" },
  { kind: "other", label: "Payroll, gov't & other" },
];

export interface PayableItem {
  key: string;
  kind: PayableKind;
  book: "Store" | "Commissary";
  accountCode: string;
  accountName: string;
  /** Who is paid: supplier, card, lender, person. */
  payee: string;
  label: string;
  date: string | null;
  dueDate: string | null;
  openCents: number;
  /** Already in a payment waiting for approval. */
  pendingCents: number;
  /** Opens the entry form to pay it: template number and values to fill in. */
  pay?: { template: number; values: Record<string, string> };
}

export interface PayablesSummary {
  asOf: string;
  cashCents: number;
  items: PayableItem[];
}

export type BucketKey = "overdue" | "week" | "month" | "later" | "none";

export const BUCKETS: { key: BucketKey; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "week", label: "Due in the next 7 days" },
  { key: "month", label: "Due in 8–30 days" },
  { key: "later", label: "Due later" },
  { key: "none", label: "No due date (on demand or not yet billed)" },
];

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function bucketOf(dueDate: string | null, today: string): BucketKey {
  if (!dueDate) return "none";
  if (dueDate < today) return "overdue";
  if (dueDate <= addDays(today, 7)) return "week";
  if (dueDate <= addDays(today, 30)) return "month";
  return "later";
}

/** Still to pay: what's unpaid less what's already in a payment waiting for approval. */
export const toPay = (i: PayableItem) => Math.max(0, i.openCents - i.pendingCents);

export interface WeekRow {
  label: string;
  from: string | null;
  to: string | null;
  dueCents: number;
  /** Cash left after paying everything due up to the end of this row. */
  cashAfterCents: number;
}

/**
 * Cash plan: overdue first, then week by week (7-day windows from today), then later and
 * undated. Cash after each row assumes no money comes in, so it shows how much has to be
 * collected or moved to pay on time.
 */
export function weeklyPlan(items: PayableItem[], cashCents: number, today: string, weeks = 8): WeekRow[] {
  const rows: WeekRow[] = [];
  let cash = cashCents;
  const push = (label: string, from: string | null, to: string | null, pick: (i: PayableItem) => boolean) => {
    const due = items.filter(pick).reduce((s, i) => s + toPay(i), 0);
    cash -= due;
    rows.push({ label, from, to, dueCents: due, cashAfterCents: cash });
  };
  push("Overdue", null, addDays(today, -1), (i) => !!i.dueDate && i.dueDate < today);
  for (let w = 0; w < weeks; w++) {
    const from = addDays(today, 7 * w);
    const to = addDays(today, 7 * w + 6);
    push(w === 0 ? "This week" : `Week ${w + 1}`, from, to, (i) => !!i.dueDate && i.dueDate >= from && i.dueDate <= to);
  }
  const end = addDays(today, 7 * weeks - 1);
  push("Later", addDays(end, 1), null, (i) => !!i.dueDate && i.dueDate > end);
  push("No due date", null, null, (i) => !i.dueDate);
  return rows;
}
