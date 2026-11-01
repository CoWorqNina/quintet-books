import { describe, expect, it } from "vitest";
import { isBalanced } from "./entries";
import {
  type AllowanceLine,
  amortization,
  type AssetRecord,
  bookedKey,
  depreciation,
  interestAccrual,
  inventoryAdjustment,
  type LoanRecord,
  monthsThrough,
  ownerAllowanceExcess,
  ownerFoodSummary,
  scheduledToDate,
  type SpreadRecord,
  thirteenthMonth,
} from "./monthEnd";

const lines = (g: { entry: { lines: { account_code: string; debitCents: number; creditCents: number; profit_center?: string | null }[] } }) =>
  g.entry.lines.map((l) => [l.account_code, l.debitCents, l.creditCents, l.profit_center ?? null]);

const fryer: AssetRecord = {
  id: 1, name: "Fryer", book: "Store", account_code: "1520", accum_account_code: "1592", profit_center: "GGC", cost: 18000,
  in_use_date: "2026-11-12", useful_life_months: 18, depreciated_before_go_live: 0, in_force: true, entry_id: 5, entry_status: "Approved",
};

describe("straight line", () => {
  it("counts a full month from the month put to use", () => {
    expect(monthsThrough("2026-11-12", "2026-11")).toBe(1);
    expect(monthsThrough("2026-11-12", "2026-10")).toBe(0);
    expect(scheduledToDate(10000_00, 3, 2)).toBe(6666_66);
    expect(scheduledToDate(10000_00, 3, 3)).toBe(10000_00);
  });
});

describe("depreciation", () => {
  it("books the month's depreciation per asset, with the expense by tag", () => {
    const [g] = depreciation("2026-11", [fryer, { ...fryer, id: 2, name: "Aircon", accum_account_code: "1593", profit_center: "The Nest", cost: 24000, useful_life_months: 24 }], new Map());
    expect(lines(g)).toEqual([
      ["6810", 1000_00, 0, "GGC"],
      ["6810", 1000_00, 0, "The Nest"],
      ["1592", 0, 1000_00, null],
      ["1593", 0, 1000_00, null],
    ]);
    expect(isBalanced(g.entry)).toBe(true);
    expect(g.entry.lines[2].party_id).toBe("asset:1");
  });
  it("catches up missed months, stops at cost, and skips unapproved or reversed assets", () => {
    const booked = new Map([[bookedKey("asset:1", "1592"), -1000_00]]);
    expect(depreciation("2027-01", [fryer], booked)[0].entry.lines[0].debitCents).toBe(2000_00);
    expect(depreciation("2030-01", [fryer], new Map([[bookedKey("asset:1", "1592"), -18000_00]]))).toEqual([]);
    expect(depreciation("2026-11", [{ ...fryer, entry_status: "Submitted" }], new Map())).toEqual([]);
    expect(depreciation("2026-11", [{ ...fryer, in_force: false }], new Map())).toEqual([]);
  });
  it("go-live assets continue from what was depreciated before Nov 2026", () => {
    const reno = { ...fryer, id: 3, name: "Renovation", account_code: "1510", accum_account_code: "1591", profit_center: "Shared" as const, cost: 240000, in_use_date: "2026-04-01", useful_life_months: 24, depreciated_before_go_live: 70000, entry_id: null, entry_status: null };
    expect(depreciation("2026-11", [reno], new Map())[0].entry.lines[0]).toMatchObject({ debitCents: 10000_00, profit_center: "Shared" });
  });
});

describe("amortization", () => {
  it("reduces deferred charges through their contra account and prepaids directly", () => {
    const assume: SpreadRecord = { id: 1, name: "Assume Price", book: "Store", asset_account: "1610", expense_account: "6821", profit_center: "Shared", total: 134935, start_month: "2026-04-01", months: 24, amortized_before_go_live: 39356.03, in_force: true, entry_id: null, entry_status: null };
    const insurance: SpreadRecord = { ...assume, id: 2, name: "Insurance", asset_account: "1430", expense_account: "6823", profit_center: "The Nest", total: 12000, start_month: "2026-11-01", months: 12, amortized_before_go_live: 0, entry_id: 9, entry_status: "Approved" };
    const [g] = amortization("2026-11", [assume, insurance], new Map());
    expect(lines(g)).toEqual([
      ["6821", 5622_29, 0, "Shared"],
      ["6823", 1000_00, 0, "The Nest"],
      ["1615", 0, 5622_29, null],
      ["1430", 0, 1000_00, null],
    ]);
  });
});

describe("interest accrual", () => {
  const loan: LoanRecord = {
    id: 7, name: "UB loan", book: "Store", interest_account: "7510", in_force: true, entry_id: 1, entry_status: "Approved",
    installments: [
      { seq: 1, due_date: "2026-12-10", interest: 5000, paid_entry_id: null },
      { seq: 2, due_date: "2027-01-10", interest: 4800, paid_entry_id: null },
    ],
  };
  it("accrues the interest of the installment due next month", () => {
    expect(lines(interestAccrual("2026-11", [loan], new Map())[0])).toEqual([
      ["7510", 5000_00, 0, "GGC"],
      ["2250", 0, 5000_00, null],
    ]);
  });
  it("after the installment is paid, accrues the following one, net of what's accrued", () => {
    const paid = { ...loan, installments: loan.installments!.map((i) => (i.seq === 1 ? { ...i, paid_entry_id: 3 } : i)) };
    expect(interestAccrual("2026-12", [paid], new Map([[bookedKey("loan:7", "2250"), 0]]))[0].entry.lines[0].debitCents).toBe(4800_00);
    expect(interestAccrual("2026-11", [loan], new Map([[bookedKey("loan:7", "2250"), -5000_00]]))).toEqual([]);
  });
});

describe("13th month", () => {
  it("is 1/12 of the month's gross pay per profit center", () => {
    const [g] = thirteenthMonth("2026-11", [
      { book: "Store", profit_center: "GGC", amount: 60000 },
      { book: "Store", profit_center: "The Nest", amount: 24000 },
    ]);
    expect(lines(g)).toEqual([
      ["6115", 5000_00, 0, "GGC"],
      ["6115", 2000_00, 0, "The Nest"],
      ["2135", 0, 7000_00, null],
    ]);
  });
});

describe("inventory adjustment", () => {
  it("per item change from the last count, plus any gap with the ledger", () => {
    const g = inventoryAdjustment(
      "2026-12",
      "Commissary",
      "GGC",
      [{ item: "Rice", unit: "kg", quantity: 20, unit_value: 50, account: "5100" }],
      [{ item: "Rice", unit: "kg", quantity: 30, unit_value: 50, account: "5100" }, { item: "Oil", unit: "L", quantity: 2, unit_value: 100, account: "5150" }],
      1600_00,
    )!;
    expect(g.details).toEqual([
      { label: "Rice", cents: -500_00 },
      { label: "Oil", cents: -200_00 },
      { label: "Difference between the ledger and the last count", cents: 100_00 },
    ]);
    expect(isBalanced(g.entry)).toBe(true);
    const net = g.entry.lines.filter((l) => l.account_code === "1300").reduce((s, l) => s + l.debitCents - l.creditCents, 0);
    expect(1600_00 + net).toBe(1000_00);
  });
});

describe("owner food allowance", () => {
  const food = (owner: string, pc: "GGC" | "The Nest", d: number, c = 0): AllowanceLine => ({ book: "Store", party_name: owner, profit_center: pc, debit: d, credit: c });
  const lines = [food("Kai", "GGC", 2400), food("Kai", "The Nest", 1200), food("Nina", "GGC", 1800)];
  it("summarizes per owner and moves only what's above ₱3,000 to the owner's receivable", () => {
    expect(ownerFoodSummary(lines, 3000_00).map((s) => [s.owner, s.takenCents, s.excessCents])).toEqual([
      ["Kai", 3600_00, 600_00],
      ["Nina", 1800_00, 0],
    ]);
    const [g] = ownerAllowanceExcess("2026-11", lines, 3000_00, new Map([["Kai", "recKai"]]));
    expect(g.entry.lines.map((l) => [l.account_code, l.profit_center ?? null, l.debitCents, l.creditCents, l.party_id])).toEqual([
      ["6135", "GGC", 0, 400_00, "recKai"],
      ["6135", "The Nest", 0, 200_00, "recKai"],
      ["1255", null, 600_00, 0, "recKai"],
    ]);
  });
  it("after the excess is moved, only new food above the allowance is moved again", () => {
    const moved = [...lines, food("Kai", "GGC", 0, 600)];
    expect(ownerAllowanceExcess("2026-11", moved, 3000_00, new Map())).toEqual([]);
    expect(ownerAllowanceExcess("2026-11", [...moved, food("Kai", "GGC", 150)], 3000_00, new Map())[0].details[0].cents).toBe(150_00);
  });
});
