import { describe, expect, it } from "vitest";
import { isBalanced } from "./entries";
import { getTemplate, type TemplateContext } from "./templates";
import type { Account, Book, Party } from "./types";
import testAccounts from "./test-accounts.json";

const party = (id: string, name: string, type: Party["type"], approved = true): Party => ({
  id, name, type, books: ["Store"], profitCenter: "GGC", active: true, approved,
  approvalStatus: type === "Supplier" ? (approved ? "Approved" : "Pending") : null,
  contactDetails: null, paymentTerms: null, itemsSupplied: null, addedBy: null,
});
const parties = [
  party("recSup", "Davao Poultry", "Supplier"),
  party("recNew", "New Supplier Co", "Supplier", false),
  party("recAna", "Ana", "Employee"),
  party("recUB", "Union Bank", "Lender"),
  party("recKai", "Kai Denila", "Owner"),
];
export const testCtx = (over: Partial<TemplateContext> = {}): TemplateContext => ({
  book: "Store",
  profitCenter: "GGC",
  accounts: new Map((testAccounts as Account[]).map((a) => [a.code, a])),
  parties: new Map(parties.map((p) => [p.id, p])),
  ...over,
});
const ctx = testCtx();
const photo = { path: "p", name: "p.jpg", type: "image/jpeg", size: 1 };
const build = (n: number, values: Record<string, unknown>, c = ctx) => getTemplate(n)!.build(values as never, c);
const lines = (r: ReturnType<typeof build>, i = 0) => r.entries[i].lines.map((l) => [l.account_code, l.debitCents, l.creditCents]);

describe("cash and bank templates", () => {
  it("#7 card payout: bank net, fees, clearing gross", () => {
    const r = build(7, { date: "2026-11-03", bank: "1140", gross: 11477, fees: 286.93, reference: "SB123" });
    expect(r.errors).toEqual([]);
    expect(lines(r)).toEqual([
      ["1140", 11190_07, 0],
      ["6555", 286_93, 0],
      ["1181", 0, 11477_00],
    ]);
  });

  it("#8 platform payout splits commission, deductions and withholding tax", () => {
    const r = build(8, { date: "2026-11-07", platform: "Grab", receivedIn: "1140", gross: 10000, commission: 2500, deductions: 100, withholding: 50, reference: "W45", proof: photo });
    expect(r.errors).toEqual([]);
    expect(isBalanced(r.entries[0])).toBe(true);
    expect(r.entries[0].lines.find((l) => l.account_code === "1140")!.debitCents).toBe(7350_00);
    expect(build(8, { date: "2026-11-07", platform: "Grab", receivedIn: "1140", gross: 100, reference: "x" }).errors).toContain(
      "Weekly platform statement is required.",
    );
  });

  it("#9 deposits go to any bank or e-wallet: The Nest's cash into GoTyme", () => {
    const r = build(9, { date: "2026-11-03", bank: "1170", amount: 5000, reference: "x", proof: photo }, testCtx({ profitCenter: "The Nest" }));
    expect(r.errors).toEqual([]);
    expect(lines(r)).toEqual([
      ["1170", 5000_00, 0],
      ["1156", 0, 5000_00],
    ]);
    expect(build(9, { date: "2026-11-03", bank: "1110", amount: 1, reference: "x", proof: photo }).errors.join()).toMatch(/can't be used here/);
  });

  it("#10 transfer needs two different accounts", () => {
    const t = build(10, { date: "2026-11-03", from: "1110", to: "1110", amount: 5, fromReference: "a", toReference: "b" });
    expect(t.errors).toContain("Sending and receiving accounts must differ.");
  });

  it("#5 pop-up sales record the event and gross up discounts", () => {
    const r = build(5, { date: "2026-11-08", event: "Abreeza bazaar", channel: "cash", amount: 950, discounts: 50, discountAccount: "4181" });
    expect(r.errors).toEqual([]);
    expect(r.entries[0].lines.find((l) => l.template_line === "5.sales")).toMatchObject({ creditCents: 1000_00, party_name: "Abreeza bazaar" });
  });

  it("#39 money out of a bank goes to Suspense; #40 bank charges", () => {
    expect(lines(build(39, { date: "2026-11-03", direction: "out", account: "1140", amount: 99, description: "Unknown debit" }))).toEqual([
      ["1195", 99_00, 0],
      ["1140", 0, 99_00],
    ]);
    expect(lines(build(40, { date: "2026-11-03", bank: "1145", amount: 15, description: "Transfer fee", proof: photo }, testCtx({ book: "Commissary" })))).toEqual([
      ["6740", 15_00, 0],
      ["1145", 0, 15_00],
    ]);
  });
});

describe("purchase templates", () => {
  const chicken = { account: "5130", description: "Wings", quantity: 20, unit: "kg", unitPrice: 210, amount: 4200 };
  const oil = { account: "5150", description: "Oil", quantity: 2, unit: "tin", unitPrice: 1450, amount: 2900 };

  it("#11 petty cash expense rules", () => {
    expect(build(11, { date: "2026-11-03", description: "Chicken", lines: [{ account: "5130", amount: 500 }], receipt: photo }).errors).toContain(
      "Line 1: ingredients need quantity, unit and unit price.",
    );
    const ok = build(11, { date: "2026-11-03", description: "Tissue", lines: [{ account: "6610", amount: 80 }], noReceiptApproved: true });
    expect(ok.errors).toEqual([]);
    expect(ok.entries[0].unsupported).toBe(true);
    expect(build(11, { date: "2026-11-03", description: "x", lines: [{ account: "4100", amount: 80 }], receipt: photo }).errors.join()).toMatch(
      /can't be used here/,
    );
  });

  it("#12 paid purchase with several items, tagged per profit center", () => {
    const r = build(12, {
      date: "2026-11-03", supplier: "recSup", paidFrom: "1140", reference: "OR 77", receipt: photo,
      lines: [chicken, { ...oil, profitCenter: "The Nest" }],
    });
    expect(r.errors).toEqual([]);
    expect(lines(r)).toEqual([
      ["5130", 4200_00, 0],
      ["5150", 2900_00, 0],
      ["1140", 0, 7100_00],
    ]);
    expect(r.entries[0].lines[1]).toMatchObject({ profit_center: "The Nest", quantity: 2, unit: "tin", unit_price: 1450, party_name: "Davao Poultry" });
  });

  it("#12 refuses suppliers waiting for approval", () => {
    const r = build(12, { date: "2026-11-03", supplier: "recNew", paidFrom: "1140", reference: "x", receipt: photo, lines: [chicken] });
    expect(r.errors).toContain("Supplier: New Supplier Co is waiting for owner approval.");
  });

  it("#13 credit purchase in the Commissary book posts to Accounts Payable per supplier, tagged GGC", () => {
    const r = build(13, { date: "2026-11-03", supplier: "recSup", reference: "INV-9", deliveryDate: "2026-11-03", invoice: photo, lines: [{ ...chicken, profitCenter: "The Nest" }] }, testCtx({ book: "Commissary" }));
    expect(r.errors).toEqual([]);
    expect(r.entries[0].book).toBe("Commissary");
    expect(r.entries[0].lines[0].profit_center).toBe("GGC");
    expect(r.entries[0].lines[1]).toMatchObject({ account_code: "2100", creditCents: 4200_00, party_id: "recSup" });
  });

  it("#14-#18 supplier payment, advance, delivery, personal funds, reimbursement", () => {
    expect(lines(build(14, { date: "2026-11-03", supplier: "recSup", amount: 4200, paidFrom: "1140", reference: "INV-9" }))).toEqual([
      ["2100", 4200_00, 0],
      ["1140", 0, 4200_00],
    ]);
    expect(lines(build(15, { date: "2026-11-03", supplier: "recSup", amount: 1000, paidFrom: "1150", reference: "GC1" }))).toEqual([
      ["1260", 1000_00, 0],
      ["1150", 0, 1000_00],
    ]);
    expect(lines(build(16, { date: "2026-11-04", supplier: "recSup", reference: "DR1", receipt: photo, lines: [{ ...chicken, amount: 1000, quantity: 5, unitPrice: 200 }] }))).toEqual([
      ["5130", 1000_00, 0],
      ["1260", 0, 1000_00],
    ]);
    const p = build(17, { date: "2026-11-04", person: "2113", supplier: "S&R", receipt: photo, lines: [{ account: "6610", amount: 1500 }] });
    expect(p.errors).toEqual([]);
    expect(lines(p)).toEqual([
      ["6610", 1500_00, 0],
      ["2113", 0, 1500_00],
    ]);
    expect(lines(build(18, { date: "2026-11-05", person: "2113", amount: 1500, paidFrom: "1140", reference: "S&R Nov 4" }))).toEqual([
      ["2113", 1500_00, 0],
      ["1140", 0, 1500_00],
    ]);
  });

  it("#30 small items under ₱3,000 only, paid or on credit", () => {
    expect(build(30, { date: "2026-11-03", description: "Fryer", amount: 3000, paidBy: "account", paidFrom: "1120", receipt: photo }).errors.join()).toMatch(
      /Asset Purchase/,
    );
    expect(lines(build(30, { date: "2026-11-03", description: "Tongs", amount: 450, paidBy: "account", paidFrom: "1120", receipt: photo }))).toEqual([
      ["6620", 450_00, 0],
      ["1120", 0, 450_00],
    ]);
    const credit = build(30, { date: "2026-11-03", description: "Scale", amount: 2500, paidBy: "credit", supplier: "recSup", receipt: photo });
    expect(credit.entries[0].lines[1]).toMatchObject({ account_code: "2100", party_name: "Davao Poultry" });
  });
});

describe("employee templates", () => {
  it("#26 advance, #27 collection, #28 write-off (one-by-one approval)", () => {
    expect(lines(build(26, { date: "2026-11-03", employee: "recAna", amount: 500, paidFrom: "1120", proof: photo }))).toEqual([
      ["1242", 500_00, 0],
      ["1120", 0, 500_00],
    ]);
    expect(lines(build(27, { date: "2026-11-03", employee: "recAna", receivable: "1241", amount: 49.8, receivedInto: "1110", proof: photo }))).toEqual([
      ["1110", 49_80, 0],
      ["1241", 0, 49_80],
    ]);
    const w = build(28, { date: "2026-11-30", employee: "recAna", amount: 49.8, reason: "Below threshold" });
    expect(lines(w)).toEqual([
      ["7140", 49_80, 0],
      ["1241", 0, 49_80],
    ]);
    expect(getTemplate(28)!.batchApproval).toBe(false);
    expect(build(26, { date: "2026-11-03", employee: "recSup", amount: 1, paidFrom: "1120", proof: photo }).errors).toContain(
      "Employee: choose an active employee.",
    );
  });

  it("Commissary entries can only use Commissary accounts", () => {
    const c = testCtx({ book: "Commissary" as Book });
    expect(build(26, { date: "2026-11-03", employee: "recAna", amount: 1, paidFrom: "1140", proof: photo }, c).errors.join()).toMatch(/can't be used here/);
    expect(build(26, { date: "2026-11-03", employee: "recAna", amount: 1, paidFrom: "1145", proof: photo }, c).errors).toEqual([]);
  });
});

describe("Commissary templates (both books)", () => {
  const products = new Map([
    ["recMar", { id: "recMar", name: "Marinated Chicken", unit: "kg", cogsAccount: "5130", active: true }],
    ["recSau", { id: "recSau", name: "Cheese Sauce", unit: "tub", cogsAccount: "5140", active: true }],
    ["recBad", { id: "recBad", name: "Mystery", unit: "pc", cogsAccount: "6610", active: true }],
  ]);
  const c = testCtx({ products });

  it("#20 bills the Store per product and keeps Due from/Due to equal", () => {
    const r = build(20, {
      date: "2026-11-04", billedTo: "GGC", reference: "DS-12", slip: photo,
      lines: [{ product: "recMar", quantity: 10, unitPrice: 280 }, { product: "recSau", quantity: 2, unitPrice: 150.5 }],
    }, c);
    expect(r.errors).toEqual([]);
    const [comm, store] = r.entries;
    expect(comm.book).toBe("Commissary");
    expect(lines(r, 0)).toEqual([
      ["1280", 3101_00, 0],
      ["4190", 0, 2800_00],
      ["4190", 0, 301_00],
    ]);
    expect(store.book).toBe("Store");
    expect(lines(r, 1)).toEqual([
      ["5130", 2800_00, 0],
      ["5140", 301_00, 0],
      ["2180", 0, 3101_00],
    ]);
    expect(store.lines[0]).toMatchObject({ profit_center: "GGC", quantity: 10, unit: "kg", memo: "Marinated Chicken" });
  });

  it("#20 billing The Nest tags the Store COGS The Nest", () => {
    const r = build(20, { date: "2026-11-04", billedTo: "The Nest", reference: "DS-13", slip: photo, lines: [{ product: "recMar", quantity: 1, unitPrice: 280 }] }, c);
    expect(r.entries[1].lines[0].profit_center).toBe("The Nest");
    expect(r.entries[1].profit_center).toBe("The Nest");
  });

  it("#20 refuses products not mapped to a COGS account", () => {
    const r = build(20, { date: "2026-11-04", billedTo: "GGC", reference: "x", slip: photo, lines: [{ product: "recBad", quantity: 1, unitPrice: 1 }] }, c);
    expect(r.errors.join()).toMatch(/no valid COGS account/);
  });

  it("#19 Store pays a Commissary cost: both books move", () => {
    const r = build(19, { date: "2026-11-05", description: "LPG for Commissary", paidFrom: "1120", receipt: photo, lines: [{ account: "5170", amount: 1100, quantity: 1, unit: "tank", unitPrice: 1100 }] }, c);
    expect(r.errors).toEqual([]);
    expect(lines(r, 0)).toEqual([
      ["2180", 1100_00, 0],
      ["1120", 0, 1100_00],
    ]);
    expect(lines(r, 1)).toEqual([
      ["5170", 1100_00, 0],
      ["1280", 0, 1100_00],
    ]);
    expect(r.entries[1].lines[0].profit_center).toBe("GGC");
    expect(build(19, { date: "2026-11-05", description: "x", paidFrom: "1145", receipt: photo, lines: [{ account: "5170", amount: 1 }] }, c).errors.join()).toMatch(
      /Store paid from/,
    );
  });

  it("#21 settlement must clear the full balance", () => {
    const due = testCtx({ dueToCommissaryCents: 3101_00 });
    expect(build(21, { date: "2026-11-30", amount: 3000, paidFrom: "1140", reference: "T1" }, due).errors.join()).toMatch(/clears the full balance/);
    const r = build(21, { date: "2026-11-30", amount: 3101, paidFrom: "1140", reference: "T1" }, due);
    expect(r.errors).toEqual([]);
    expect(lines(r, 0)).toEqual([
      ["2180", 3101_00, 0],
      ["1140", 0, 3101_00],
    ]);
    expect(lines(r, 1)).toEqual([
      ["1145", 3101_00, 0],
      ["1280", 0, 3101_00],
    ]);
  });
});

describe("payroll templates", () => {
  const accrual = {
    date: "2026-11-15",
    gross: [
      { account: "6100", profitCenter: "GGC", amount: 30000 },
      { account: "6100", profitCenter: "The Nest", amount: 8000 },
      { account: "6510", profitCenter: "GGC", amount: 6000 },
    ],
    sssEr: 2500, philhealthEr: 900, pagibigEr: 400, erNest: 600,
    sssEe: 1250, philhealthEe: 900, pagibigEe: 400,
    deductions: [{ employee: "recAna", receivable: "1243", amount: 207 }],
    summary: photo,
  };

  it("#22 accrues gross pay by profit center and holds contributions and deductions as payables", () => {
    const r = build(22, accrual);
    expect(r.errors).toEqual([]);
    expect(isBalanced(r.entries[0])).toBe(true);
    expect(lines(r)).toEqual([
      ["6100", 30000_00, 0],
      ["6100", 8000_00, 0],
      ["6510", 6000_00, 0],
      ["6120", 3200_00, 0],
      ["6120", 600_00, 0],
      ["2141", 0, 3750_00],
      ["2142", 0, 1800_00],
      ["2143", 0, 800_00],
      ["1243", 0, 207_00],
      ["2130", 0, 41243_00],
    ]);
    expect(r.entries[0].lines.slice(0, 5).map((l) => l.profit_center)).toEqual(["GGC", "The Nest", "GGC", "GGC", "The Nest"]);
    expect(r.entries[0].lines[8]).toMatchObject({ party_name: "Ana" });
  });

  it("#22 is dated on the 15th or month-end, and Commissary salaries stay in the Commissary book", () => {
    expect(build(22, { ...accrual, date: "2026-11-14" }).errors).toContain("Payroll is recorded on the 15th or the last day of the month.");
    expect(build(22, { ...accrual, date: "2026-11-30" }).errors).toEqual([]);
    const comm = build(22, { ...accrual, gross: [{ account: "6100", amount: 1 }] }, testCtx({ book: "Commissary" }));
    expect(comm.errors.join()).toMatch(/can't be used here/);
  });

  it("#23-#25 payment, remittance, 13th month", () => {
    expect(lines(build(23, { date: "2026-11-20", period: "Nov 1–15", amount: 41243, paidFrom: "1140" }))).toEqual([
      ["2130", 41243_00, 0],
      ["1140", 0, 41243_00],
    ]);
    expect(lines(build(24, { date: "2026-12-10", sss: 3750, philhealth: 1800, pagibig: 800, paidFrom: "1140", reference: "Nov 2026", proof: photo }))).toEqual([
      ["2141", 3750_00, 0],
      ["2142", 1800_00, 0],
      ["2143", 800_00, 0],
      ["1140", 0, 6350_00],
    ]);
    expect(lines(build(25, { date: "2026-12-15", amount: 50000, paidFrom: "1140", list: photo }))).toEqual([
      ["2135", 50000_00, 0],
      ["1140", 0, 50000_00],
    ]);
  });
});

describe("assets, prepaids and loans", () => {
  it("#29 asset purchase: part paid, rest to the supplier, and an asset record", () => {
    const r = build(29, {
      date: "2026-11-05", name: "Fryer", assetClass: "1520", tag: "GGC", cost: 45000, paidNow: 15000, paidFrom: "1140",
      supplier: "recSup", inUseDate: "2026-11-06", receipt: photo,
    });
    expect(r.errors).toEqual([]);
    expect(lines(r)).toEqual([
      ["1520", 45000_00, 0],
      ["1140", 0, 15000_00],
      ["2100", 0, 30000_00],
    ]);
    expect(r.register).toMatchObject({ type: "asset", data: { accum_account_code: "1592", useful_life_months: 18, profit_center: "GGC", cost: 45000 } });
    expect(build(29, { date: "2026-11-05", name: "x", assetClass: "1520", tag: "GGC", cost: 2000, paidNow: 2000, paidFrom: "1140", inUseDate: "2026-11-05", receipt: photo }).errors.join()).toMatch(/Small Item/);
    expect(build(29, { date: "2026-11-05", name: "Reno", assetClass: "1510", tag: "GGC", cost: 9000, paidNow: 9000, paidFrom: "1140", inUseDate: "2026-11-05", receipt: photo }).register?.data.profit_center).toBe("Shared");
  });

  it("#31 prepaid spreads over the months covered", () => {
    const r = build(31, { date: "2026-11-05", item: "Insurance", amount: 12000, start: "2026-11-01", end: "2027-10-31", paidFrom: "1140", proof: photo });
    expect(r.errors).toEqual([]);
    expect(lines(r)).toEqual([
      ["1430", 12000_00, 0],
      ["1140", 0, 12000_00],
    ]);
    expect(r.register).toMatchObject({ type: "spread", data: { months: 12, start_month: "2026-11-01", expense_account: "6823" } });
    expect(build(31, { date: "2026-11-05", item: "x", amount: 5000, start: "2026-11-01", end: "2026-11-30", paidFrom: "1140", proof: photo }).errors.join()).toMatch(/one-month/);
  });

  it("#33 loan proceeds net of fees with the schedule from the lender's installment", () => {
    const r = build(33, {
      date: "2026-11-10", name: "UB loan", lender: "recUB", account: "2230", interestAccount: "7530", principal: 400000, fees: 2000,
      receivedIn: "1140", months: 24, firstDue: "2026-12-10", installment: 19386.67, proof: photo,
    });
    expect(r.errors).toEqual([]);
    expect(lines(r)).toEqual([
      ["1140", 398000_00, 0],
      ["7160", 2000_00, 0],
      ["2230", 0, 400000_00],
    ]);
    const inst = r.register!.data.installments as { principal: number; interest: number }[];
    expect(inst).toHaveLength(24);
    expect(inst[0]).toMatchObject({ principal: 16666.67, interest: 2720 });
    expect(inst[23]).toMatchObject({ principal: 16666.59, interest: 2720.08 });
    expect(r.register!.data).toMatchObject({ method: "straight-line", installment_amount: 19386.67 });
    expect(build(33, { date: "2026-11-10", name: "x", lender: "recUB", account: "2230", interestAccount: "7530", principal: 100.01, receivedIn: "1140", months: 2, firstDue: "2026-12-10", installment: 60, proof: photo }).errors.join()).toMatch(/don't add up to the installment/);
    const taken = testCtx({ loans: new Map([["1", { id: 1, name: "Old", accountCode: "2230", interestAccount: "7530", book: "Store", next: null }]]) });
    expect(build(33, { date: "2026-11-10", name: "x", lender: "recUB", account: "2230", interestAccount: "7530", principal: 1000, receivedIn: "1140", months: 2, firstDue: "2026-12-10", installment: 500, proof: photo }, taken).errors.join()).toMatch(/already holds/);
  });

  it("#34 installment: split from the schedule row; accrued interest clears 2250, otherwise it's expensed", () => {
    const next = { id: 70, seq: 8, dueDate: "2026-11-12", principal: 16666.67, interest: 2720, interestRecorded: true };
    const loans = new Map([["7", { id: 7, name: "UB loan", accountCode: "2230", interestAccount: "7530", book: "Store" as Book, next }]]);
    const r = build(34, { date: "2026-12-10", loan: "7", paidFrom: "1140", reference: "UB-1" }, testCtx({ loans }));
    expect(r.errors).toEqual([]);
    expect(lines(r)).toEqual([
      ["2230", 16666_67, 0],
      ["2250", 2720_00, 0],
      ["1140", 0, 19386_67],
    ]);
    const notYet = new Map([["7", { ...loans.get("7")!, next: { ...next, interestRecorded: false } }]]);
    expect(lines(build(34, { date: "2026-11-12", loan: "7", paidFrom: "1140", reference: "UB-1" }, testCtx({ loans: notYet })))).toEqual([
      ["2230", 16666_67, 0],
      ["7530", 2720_00, 0],
      ["1140", 0, 19386_67],
    ]);
    expect(r.entries[0].lines[1].party_id).toBe("loan:7");
    expect(r.register).toEqual({ type: "loan_payment", data: { installment_id: 70 } });
  });

  it("#35 and #37 owner money in is a loan, money out an advance", () => {
    const i = build(35, { date: "2026-11-03", owner: "recKai", amount: 50000, bank: "1140", reference: "x" });
    expect(lines(i)).toEqual([
      ["1140", 50000_00, 0],
      ["2260", 0, 50000_00],
    ]);
    const o = build(37, { date: "2026-11-03", owner: "recKai", amount: 1000, bank: "1140", reference: "x" });
    expect(o.entries[0].lines[0]).toMatchObject({ account_code: "1250", party_name: "Kai Denila" });
  });
});
