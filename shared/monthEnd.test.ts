import { describe, expect, it } from "vitest";
import { isBalanced } from "./entries";
import {
  type AllowanceLine,
  amortization,
  type AssetRecord,
  bookedKey,
  depreciation,
  disposal,
  interestAccrual,
  inventoryAdjustment,
  type LoanRecord,
  type LoanRow,
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

describe("interest accrual (straight-line, per schedule row)", () => {
  const row = (id: number, seq: number, due: string, over: Partial<LoanRow> = {}): LoanRow => ({
    id, seq, due_date: due, principal: 16666.67, interest: 2720, paid: false, interest_recorded: false, ...over,
  });
  const ub: LoanRecord = {
    id: 7, name: "UB loan", book: "Store", interest_account: "7510", in_force: true, entry_id: null, entry_status: null,
    installments: [
      row(77, 7, "2026-10-12", { paid: true, interest_recorded: true }),
      row(78, 8, "2026-11-12"),
      row(79, 9, "2026-12-12"),
    ],
  };
  it("accrues the interest of the row due in the closing month and links it", () => {
    const [g] = interestAccrual("2026-11", [ub], "2026-11-01");
    expect(lines(g)).toEqual([
      ["7510", 2720_00, 0, "GGC"],
      ["2250", 0, 2720_00, null],
    ]);
    expect(g.entry.lines[1].party_id).toBe("loan:7");
    expect(g.register).toEqual({ type: "loan_interest", data: { installment_ids: [78] } });
  });
  it("skips rows already recorded (accrued, or paid with the interest in the payment) and rows before go-live", () => {
    const paid = { ...ub, installments: ub.installments!.map((r) => (r.seq === 8 ? { ...r, interest_recorded: true } : r)) };
    expect(interestAccrual("2026-11", [paid], "2026-11-01")).toEqual([]);
    const lateBeforeGoLive = { ...ub, installments: [row(70, 7, "2026-10-12")] };
    expect(interestAccrual("2026-11", [lateBeforeGoLive], "2026-11-01")).toEqual([]);
  });
  it("an overdue row from an earlier month still gets its interest accrued", () => {
    expect(interestAccrual("2026-12", [ub], "2026-11-01")[0].register!.data.installment_ids).toEqual([78, 79]);
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


describe("retiring an asset", () => {
  const freezer = { ...fryer, id: 9, name: "Freezer 1", cost: 18000, in_use_date: "2026-04-01", useful_life_months: 24, depreciated_before_go_live: 5250, entry_id: null, entry_status: null };
  it("broken in November: no November depreciation, remaining book value is a loss", () => {
    const r = disposal(freezer, { date: "2026-11-20", reason: "Compressor died" }, 0);
    expect(r.figures).toMatchObject({ catchUpCents: 0, accumulatedCents: 5250_00, bookValueCents: 12750_00, lossCents: 12750_00 });
    expect(r.entry!.lines.map((l) => [l.account_code, l.debitCents, l.creditCents])).toEqual([
      ["1592", 5250_00, 0],
      ["7130", 12750_00, 0],
      ["1520", 0, 18000_00],
    ]);
    expect(isBalanced(r.entry!)).toBe(true);
  });
  it("retired in January with December not yet booked: catches up, then charges the employee", () => {
    const r = disposal(freezer, { date: "2027-01-10", reason: "Dropped", charge: { partyId: "recAna", partyName: "Ana", cents: 2000_00 } }, 750_00);
    expect(r.figures.catchUpCents).toBe(750_00); // December; November already booked
    expect(r.figures.bookValueCents).toBe(18000_00 - 5250_00 - 1500_00);
    expect(r.figures.lossCents).toBe(r.figures.bookValueCents - 2000_00);
    expect(isBalanced(r.entry!)).toBe(true);
  });
  it("sold for more than book value: a gain", () => {
    const r = disposal({ ...freezer, depreciated_before_go_live: 17250 }, { date: "2026-11-05", reason: "Sold", sale: { account: "1110", cents: 1500_00 } }, 0);
    expect(r.figures).toMatchObject({ bookValueCents: 750_00, gainCents: 750_00, lossCents: 0 });
    expect(isBalanced(r.entry!)).toBe(true);
  });
});
