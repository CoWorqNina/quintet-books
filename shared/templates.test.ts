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
