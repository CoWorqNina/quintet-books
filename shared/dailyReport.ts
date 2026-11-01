// Turns an encoded cashier report (POS sales summary + handwritten cash report) into the day's
// entries: #1 cash sales, #2 GCash, #3 card, #4 Grab/Foodpanda, #6 staff food charges,
// #11 petty cash expenses, #26 cash advances, #39 unclassified paid-outs and #10 cash-ins.
// Used by the screen for a live preview and by the server, which rebuilds and checks it.

import { ACCOUNTS, bookAllowed, cashAccountsFor, isBankAccount, isExpenseAccount, needsQuantity, profitCenterAllowed } from "./accounts";
import { credit, debit, type Attachment, type EntryDraft, finishEntry, signed } from "./entries";
import { formatPeso, sumCents, toCents } from "./money";
import type { Account } from "./types";

export const NO_RECEIPT_LIMIT_CENTS = 300_00;

export type DailyProfitCenter = "GGC" | "The Nest";

export interface PaidOut {
  kind: "expense" | "advance" | "unclassified";
  description: string;
  amount: number;
  accountCode?: string; // expense only
  employeeId?: string; // advance only
  employeeName?: string;
  supplier?: string;
  quantity?: number | null;
  unit?: string | null;
  unitPrice?: number | null;
  receipt?: Attachment | null; // receipt (expense) or signed acknowledgment (advance)
  noReceiptApproved?: boolean; // expense of ₱300 or less without receipt, approved by the Supervisor
}

export interface CashIn {
  amount: number;
  sourceAccount: string; // Cash on Hand – For Deposit or any bank / e-wallet
  reference: string;
}

export interface FoodCharge {
  /** An employee (charged to their receivable, deducted from pay) or an owner (Owner's Allowance). */
  employeeId: string;
  employeeName: string;
  amount: number;
  owner?: boolean;
}

export interface DailyReportInput {
  businessDate: string; // YYYY-MM-DD, the trading day (POS may print after midnight)
  profitCenter: DailyProfitCenter;
  pos: {
    gross: number;
    refunds: number;
    discounts: number;
    net: number;
    cash: number;
    card: number;
    gcash: number;
    grab: number;
    foodpanda: number;
    foodCharges: number;
  };
  discountAccount?: string | null; // 4181 SC/PWD or 4182 Promo; all discounts sit on the cash sales entry
  drawer: {
    beginningPettyCash: number;
    actualCash: number;
    cashRemitted: number;
    nextDayPettyCash: number;
    cashierId?: string | null; // required when the drawer is short
    cashierName?: string | null;
  };
  cashIns: CashIn[];
  paidOuts: PaidOut[];
  foodCharges: FoodCharge[];
  attachments: Attachment[]; // POS slips and the handwritten report
  notes?: string;
}

export interface DailyReportFigures {
  paidOutCents: number;
  cashInCents: number;
  expectedCashCents: number;
  overShortCents: number; // positive = over, negative = short
  pettyCashTopUpCents: number;
}

export interface DailyReportResult {
  figures: DailyReportFigures;
  entries: EntryDraft[];
  errors: string[];
  warnings: string[];
}

export function buildDailyReport(
  input: DailyReportInput,
  accounts: Map<string, Account>,
): DailyReportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const pc = input.profitCenter;
  const cash = cashAccountsFor(pc);
  const date = input.businessDate;
  const c = (v: number | null | undefined) => toCents(v ?? 0);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push("Enter the business date.");
  if (!input.attachments.length) errors.push("Attach photos of the POS slips and the handwritten cash report.");

  const pos = {
    gross: c(input.pos.gross),
    refunds: c(input.pos.refunds),
    discounts: c(input.pos.discounts),
    net: c(input.pos.net),
    cash: c(input.pos.cash),
    card: c(input.pos.card),
    gcash: c(input.pos.gcash),
    grab: c(input.pos.grab),
    foodpanda: c(input.pos.foodpanda),
    foodCharges: c(input.pos.foodCharges),
  };
  if (Object.values(pos).some((v) => Number.isNaN(v) || v < 0)) errors.push("POS amounts must be numbers of zero or more.");

  if (pos.gross - pos.refunds - pos.discounts !== pos.net) {
    errors.push(
      `POS figures don't add up: gross ${formatPeso(pos.gross)} − refunds ${formatPeso(pos.refunds)} − discounts ` +
        `${formatPeso(pos.discounts)} should equal net sales ${formatPeso(pos.net)}.`,
    );
  }
  const channelTotal = pos.cash + pos.card + pos.gcash + pos.grab + pos.foodpanda + pos.foodCharges;
  if (channelTotal !== pos.net) {
    errors.push(`Payment channels add up to ${formatPeso(channelTotal)} but net sales is ${formatPeso(pos.net)}.`);
  }
  if (pos.discounts > 0 && !input.discountAccount) errors.push("Choose whether the discounts are SC/PWD or Promo.");
  if (input.discountAccount && !(input.discountAccount === ACCOUNTS.discountScPwd || input.discountAccount === ACCOUNTS.discountPromo)) {
    errors.push("Discounts go to SC/PWD (4181) or Promo (4182).");
  }
  if (pos.gcash > 0 && !cash.gcash) errors.push(`${pc}'s GCash account is not set up yet, so GCash sales can't be recorded.`);

  // Drawer arithmetic, as on the handwritten cash report.
  const beginning = c(input.drawer.beginningPettyCash);
  const actual = c(input.drawer.actualCash);
  const remitted = c(input.drawer.cashRemitted);
  const nextDay = c(input.drawer.nextDayPettyCash);
  const paidOutCents = sumCents(input.paidOuts.map((p) => c(p.amount)));
  const cashInCents = sumCents(input.cashIns.map((ci) => c(ci.amount)));
  const expectedCashCents = beginning + pos.cash + cashInCents - paidOutCents;
  const overShortCents = actual - expectedCashCents;
  // Moves Petty Cash – Cashier from (beginning + cash-ins − paid-outs) to the next-day amount.
  const pettyCashTopUpCents = nextDay - beginning - cashInCents + paidOutCents;

  if (remitted + nextDay !== actual) {
    errors.push(
      `Cash remitted ${formatPeso(remitted)} + next-day petty cash ${formatPeso(nextDay)} should equal the actual count ${formatPeso(actual)}.`,
    );
  }
  if (overShortCents < 0 && !input.drawer.cashierId) errors.push("The drawer is short: choose the cashier responsible.");

  const base = { kind: "Template" as const, book: "Store" as const, profit_center: pc, entry_date: date };
  const tagged = { profit_center: pc };
  const entries: (EntryDraft | null)[] = [];

  // #1 Daily Cash Sales (all discounts recorded here, per management)
  entries.push(
    finishEntry({
      ...base,
      transaction_type: 1,
      description: `Daily cash sales ${date}`,
      lines: [
        debit(cash.forDeposit, remitted, "1.for_deposit"),
        signed(cash.pettyCash, pettyCashTopUpCents, "1.petty_cash_left"),
        debit(input.discountAccount ?? ACCOUNTS.discountPromo, pos.discounts, "1.discounts", tagged),
        debit(ACCOUNTS.receivableShortages, overShortCents < 0 ? -overShortCents : 0, "1.shortage", {
          party_id: input.drawer.cashierId ?? null,
          party_name: input.drawer.cashierName ?? null,
        }),
        credit(ACCOUNTS.salesCash, pos.cash + pos.discounts, "1.sales_cash", tagged),
        credit(ACCOUNTS.cashOverShort, overShortCents > 0 ? overShortCents : 0, "1.over", tagged),
      ],
    }),
  );

  // #2 GCash, #3 card, #4 Grab / Foodpanda
  if (cash.gcash) {
    entries.push(
      finishEntry({
        ...base,
        transaction_type: 2,
        description: `Daily GCash sales ${date}`,
        lines: [debit(cash.gcash, pos.gcash, "2.gcash"), credit(ACCOUNTS.salesGcash, pos.gcash, "2.sales", tagged)],
      }),
    );
  }
  entries.push(
    finishEntry({
      ...base,
      transaction_type: 3,
      description: `Daily card sales ${date}`,
      lines: [debit(cash.cardClearing, pos.card, "3.clearing"), credit(ACCOUNTS.salesCard, pos.card, "3.sales", tagged)],
    }),
    finishEntry({
      ...base,
      transaction_type: 4,
      description: `Daily Grab sales ${date}`,
      lines: [debit(cash.grabClearing, pos.grab, "4.clearing"), credit(ACCOUNTS.salesGrab, pos.grab, "4.sales", tagged)],
    }),
    finishEntry({
      ...base,
      transaction_type: 4,
      description: `Daily Foodpanda sales ${date}`,
      lines: [
        debit(cash.foodpandaClearing, pos.foodpanda, "4.clearing"),
        credit(ACCOUNTS.salesFoodpanda, pos.foodpanda, "4.sales", tagged),
      ],
    }),
  );

  // #6 Food charges: employees owe it (deducted from pay); owners use their monthly food
  // allowance (anything above it moves to a receivable at month-end).
  const chargeTotal = sumCents(input.foodCharges.map((f) => c(f.amount)));
  if (chargeTotal !== pos.foodCharges) {
    errors.push(
      `Food charges per employee add up to ${formatPeso(chargeTotal)} but the POS shows ${formatPeso(pos.foodCharges)}.`,
    );
  }
  if (input.foodCharges.some((f) => !f.employeeId)) errors.push("Choose who to charge for every food charge.");
  entries.push(
    finishEntry({
      ...base,
      transaction_type: 6,
      description: `Staff and owner food charges ${date}`,
      lines: [
        ...input.foodCharges.map((f) =>
          f.owner
            ? debit(ACCOUNTS.ownerFoodAllowance, c(f.amount), "6.allowance", { party_id: f.employeeId, party_name: f.employeeName, ...tagged })
            : debit(ACCOUNTS.receivableFoodCharges, c(f.amount), "6.receivable", {
                party_id: f.employeeId,
                party_name: f.employeeName,
              }),
        ),
        credit(ACCOUNTS.salesStaffCharges, chargeTotal, "6.sales", tagged),
      ],
    }),
  );

  // Paid-outs from the drawer: #11 expenses, #26 cash advances, #39 unclassified
  input.paidOuts.forEach((p, i) => {
    const n = i + 1;
    const amount = c(p.amount);
    const label = p.description?.trim();
    if (!label) errors.push(`Paid-out ${n}: add a description.`);
    if (!(amount > 0)) errors.push(`Paid-out ${n}: enter an amount.`);

    if (p.kind === "expense") {
      const account = p.accountCode ? accounts.get(p.accountCode) : undefined;
      if (!account || !isExpenseAccount(account)) {
        errors.push(`Paid-out ${n} (${label}): choose an expense or ingredient account.`);
      } else {
        if (!bookAllowed(account, "Store")) errors.push(`Paid-out ${n}: ${account.code} is not a Store account.`);
        if (!profitCenterAllowed(account, pc)) errors.push(`Paid-out ${n}: ${account.code} ${account.name} can't be tagged ${pc}.`);
        if (needsQuantity(account)) {
          if (!(Number(p.quantity) > 0) || !p.unit?.trim() || !(Number(p.unitPrice) > 0)) {
            errors.push(`Paid-out ${n} (${label}): ingredients need quantity, unit and unit price.`);
          } else if (Math.abs(toCents(Number(p.quantity) * Number(p.unitPrice)) - amount) > 100) {
            warnings.push(`Paid-out ${n} (${label}): quantity × unit price doesn't match the amount.`);
          }
        }
      }
      let unsupported = false;
      if (!p.receipt) {
        if (amount > NO_RECEIPT_LIMIT_CENTS) errors.push(`Paid-out ${n} (${label}): over ₱300 needs a receipt photo.`);
        else if (!p.noReceiptApproved) errors.push(`Paid-out ${n} (${label}): attach the receipt, or tick that the Supervisor approved it without one.`);
        else unsupported = true;
      }
      entries.push(
        finishEntry({
          ...base,
          transaction_type: 11,
          description: label || "Petty cash expense",
          source_document: p.supplier?.trim() || null,
          unsupported,
          attachments: p.receipt ? [p.receipt] : [],
          lines: [
            debit(p.accountCode ?? "", amount, "11.expense", {
              ...tagged,
              party_name: p.supplier?.trim() || null,
              quantity: account && needsQuantity(account) ? Number(p.quantity) : null,
              unit: account && needsQuantity(account) ? p.unit?.trim() : null,
              unit_price: account && needsQuantity(account) ? Number(p.unitPrice) : null,
              memo: label,
            }),
            credit(cash.pettyCash, amount, "11.petty_cash"),
          ],
        }),
      );
    } else if (p.kind === "advance") {
      if (!p.employeeId) errors.push(`Paid-out ${n} (${label}): choose the employee who got the cash advance.`);
      if (!p.receipt) errors.push(`Paid-out ${n} (${label}): attach the signed acknowledgment.`);
      entries.push(
        finishEntry({
          ...base,
          transaction_type: 26,
          description: label || "Employee cash advance",
          attachments: p.receipt ? [p.receipt] : [],
          lines: [
            debit(ACCOUNTS.receivableAdvances, amount, "26.receivable", {
              party_id: p.employeeId ?? null,
              party_name: p.employeeName ?? null,
              memo: label,
            }),
            credit(cash.pettyCash, amount, "26.petty_cash"),
          ],
        }),
      );
    } else {
      warnings.push(`Paid-out ${n} (${label}) goes to Suspense until management classifies it.`);
      entries.push(
        finishEntry({
          ...base,
          transaction_type: 39,
          description: label || "Unclassified paid-out",
          attachments: p.receipt ? [p.receipt] : [],
          lines: [
            debit(ACCOUNTS.suspense, amount, "39.suspense", { memo: label }),
            credit(cash.pettyCash, amount, "39.petty_cash"),
          ],
        }),
      );
    }
  });

  // #10 Cash put into the drawer from another of our own accounts
  input.cashIns.forEach((ci, i) => {
    const amount = c(ci.amount);
    if (!(amount > 0)) errors.push(`Cash in ${i + 1}: enter an amount.`);
    if (ci.sourceAccount !== cash.forDeposit && !isBankAccount(accounts.get(ci.sourceAccount))) {
      errors.push(`Cash in ${i + 1}: choose where the cash came from.`);
    }
    if (!ci.reference?.trim()) errors.push(`Cash in ${i + 1}: add a reference.`);
    entries.push(
      finishEntry({
        ...base,
        transaction_type: 10,
        description: `Cash into drawer ${date}`,
        source_document: ci.reference?.trim() || null,
        lines: [debit(cash.pettyCash, amount, "10.receiving"), credit(ci.sourceAccount, amount, "10.sending")],
      }),
    );
  });

  return {
    figures: { paidOutCents, cashInCents, expectedCashCents, overShortCents, pettyCashTopUpCents },
    entries: entries.filter((e): e is EntryDraft => e !== null),
    errors,
    warnings,
  };
}
