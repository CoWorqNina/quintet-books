import { describe, expect, it } from "vitest";
import { buildDailyReport, type DailyReportInput } from "./dailyReport";
import { entryTotals, isBalanced } from "./entries";
import type { Account } from "./types";
import testAccounts from "./test-accounts.json";

const accounts = new Map((testAccounts as Account[]).map((a) => [a.code, a]));
const photo = { path: "2026/10/x.jpg", name: "x.jpg", type: "image/jpeg", size: 1 };

// GGC cashier report for Oct 29, 2026 (POS printed 10/30 1:16 AM), as on the slips.
function oct29(): DailyReportInput {
  return {
    businessDate: "2026-10-29",
    profitCenter: "GGC",
    pos: { gross: 47784, refunds: 1244, discounts: 174.8, net: 46365.2, cash: 21823.8, card: 11477, gcash: 12640.4, grab: 9, foodpanda: 8, foodCharges: 407 },
    discountAccount: "4182",
    drawer: { beginningPettyCash: 3615, actualCash: 23195, cashRemitted: 18000, nextDayPettyCash: 5195 },
    cashIns: [],
    paidOuts: [
      { kind: "expense", description: "Basura", amount: 100, accountCode: "6322", noReceiptApproved: true },
      { kind: "expense", description: "Mineral water", amount: 900, accountCode: "5195", quantity: 18, unit: "gal", unitPrice: 50, receipt: photo },
      { kind: "unclassified", description: "Refund", amount: 209 },
      { kind: "expense", description: "Grab driver", amount: 32, accountCode: "6760", noReceiptApproved: true },
      { kind: "expense", description: "Ice", amount: 128, accountCode: "5195", quantity: 4, unit: "bag", unitPrice: 32, noReceiptApproved: true },
      { kind: "expense", description: "Ice", amount: 420, accountCode: "5195", quantity: 10, unit: "bag", unitPrice: 42, receipt: photo },
      { kind: "advance", description: "Cash out", amount: 500, employeeId: "recEmp1", employeeName: "Ana", receipt: photo },
    ],
    foodCharges: [
      { employeeId: "recEmp1", employeeName: "Ana", amount: 207 },
      { employeeId: "recEmp2", employeeName: "Ben", amount: 200 },
    ],
    attachments: [photo],
  };
}

describe("buildDailyReport", () => {
  it("reproduces the handwritten cash report", () => {
    const r = buildDailyReport(oct29(), accounts);
    expect(r.errors).toEqual([]);
    expect(r.figures.paidOutCents).toBe(2289_00);
    expect(r.figures.expectedCashCents).toBe(23149_80);
    expect(r.figures.overShortCents).toBe(45_20);
    expect(r.figures.pettyCashTopUpCents).toBe(3869_00);
  });

  it("builds balanced entries with the agreed accounts", () => {
    const r = buildDailyReport(oct29(), accounts);
    for (const e of r.entries) expect(isBalanced(e), `entry #${e.transaction_type} ${e.description}`).toBe(true);
    const cash = r.entries.find((e) => e.transaction_type === 1)!;
    const line = (code: string) => cash.lines.find((l) => l.account_code === code)!;
    expect(line("1110").debitCents).toBe(18000_00);
    expect(line("1120").debitCents).toBe(3869_00);
    expect(line("4182").debitCents).toBe(174_80);
    expect(line("4100").creditCents).toBe(21998_60); // cash sales before discounts
    expect(line("7140").creditCents).toBe(45_20);
    expect(entryTotals(cash).debitCents).toBe(22043_80);

    expect(r.entries.map((e) => e.transaction_type).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 4, 6, 11, 11, 11, 11, 11, 26, 39]);
    const staff = r.entries.find((e) => e.transaction_type === 6)!;
    expect(staff.lines.filter((l) => l.account_code === "1243").map((l) => l.party_name)).toEqual(["Ana", "Ben"]);
  });

  it("keeps petty cash equal to what is left in the drawer", () => {
    const r = buildDailyReport(oct29(), accounts);
    let petty = 3615_00;
    for (const e of r.entries) for (const l of e.lines) if (l.account_code === "1120") petty += l.debitCents - l.creditCents;
    expect(petty).toBe(5195_00);
  });

  it("flags expenses without receipts as unsupported", () => {
    const r = buildDailyReport(oct29(), accounts);
    const expenses = r.entries.filter((e) => e.transaction_type === 11);
    expect(expenses.filter((e) => e.unsupported).map((e) => e.description)).toEqual(["Basura", "Grab driver", "Ice"]);
  });

  it("records a short drawer against the cashier", () => {
    const input = oct29();
    input.drawer.actualCash = 23100;
    input.drawer.cashRemitted = 17905;
    expect(buildDailyReport(input, accounts).errors).toContain("The drawer is short: choose the cashier responsible.");
    input.drawer.cashierId = "recEmp1";
    input.drawer.cashierName = "Ana";
    const r = buildDailyReport(input, accounts);
    expect(r.errors).toEqual([]);
    const short = r.entries[0].lines.find((l) => l.account_code === "1241")!;
    expect(short).toMatchObject({ debitCents: 49_80, party_name: "Ana" });
    expect(isBalanced(r.entries[0])).toBe(true);
  });

  it("catches typing mistakes", () => {
    const input = oct29();
    input.pos.card = 11476;
    input.drawer.cashRemitted = 18001;
    input.foodCharges[1].amount = 199;
    input.paidOuts[1].quantity = null;
    input.paidOuts[2].amount = 400;
    const errors = buildDailyReport(input, accounts).errors.join("\n");
    expect(errors).toMatch(/Payment channels add up/);
    expect(errors).toMatch(/should equal the actual count/);
    expect(errors).toMatch(/Food charges per employee/);
    expect(errors).toMatch(/ingredients need quantity/);
  });

  it("refuses ₱300+ expenses without a receipt and wrong-profit-center accounts", () => {
    const input = oct29();
    input.paidOuts[1].receipt = null;
    input.paidOuts.push({ kind: "expense", description: "Coffee beans", amount: 10, accountCode: "5210", quantity: 1, unit: "kg", unitPrice: 10, receipt: photo });
    input.drawer.nextDayPettyCash = 5185;
    input.drawer.cashRemitted = 18010;
    const errors = buildDailyReport(input, accounts).errors.join("\n");
    expect(errors).toMatch(/over ₱300 needs a receipt/);
    expect(errors).toMatch(/5210 Coffee Beans can't be tagged GGC/);
  });

  it("uses The Nest's own cash accounts and blocks GCash until its account exists", () => {
    const input = oct29();
    input.profitCenter = "The Nest";
    input.paidOuts = [];
    input.drawer.nextDayPettyCash = 5195 - 2289;
    input.drawer.cashRemitted = 18000 + 2289;
    input.drawer.actualCash = 23195 + 2289;
    const r = buildDailyReport(input, accounts);
    expect(r.errors.join("\n")).toMatch(/The Nest's GCash account is not set up/);
    const cash = r.entries.find((e) => e.transaction_type === 1)!;
    expect(cash.lines.map((l) => l.account_code)).toEqual(expect.arrayContaining(["1156", "1157"]));
    expect(cash.lines.find((l) => l.account_code === "4100")!.profit_center).toBe("The Nest");
  });
});
