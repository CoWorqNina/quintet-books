import { describe, expect, it } from "vitest";
import type { AccountTotal } from "./ledger";
import { balanceSheet, balanceSheetColumn, cashAccounts, cashFlows, type CashLine, incomeStatement, pcOf, type StatementTotal } from "./statements";
import testAccounts from "./test-accounts.json";
import type { Account } from "./types";

const list = testAccounts as Account[];
const accounts = new Map(list.map((a) => [a.code, a]));
const st = (code: string, book: "Store" | "Commissary", pc: StatementTotal["profit_center"], debit: number, credit: number, intercompany = false, period = "2027-03"): StatementTotal => ({
  period_key: period, book, account_code: code, profit_center: pc, intercompany, debit, credit,
});
const row = (rows: ReturnType<typeof incomeStatement>, label: string) => rows.find((r) => r.label === label)!;

const totals = [
  st("4100", "Store", "GGC", 0, 10000),
  st("4100", "Store", "The Nest", 0, 4000),
  st("4181", "Store", "GGC", 500, 0),
  st("5130", "Store", "GGC", 3000, 0),
  st("5120", "Store", "GGC", 800, 0, true), // billed by the Commissary
  st("4190", "Commissary", "GGC", 0, 800, true),
  st("5130", "Commissary", null, 600, 0),
  st("6610", "Store", "The Nest", 200, 0),
  st("6823", "Store", "Shared", 100, 0),
  st("7510", "Store", "GGC", 50, 0),
];

describe("income statement", () => {
  const cols = ["GGC", "The Nest", "Shared", "Total"];
  const rows = incomeStatement(totals, accounts, "business", cols, (t) => [pcOf(t), "Total"]);
  it("columns by profit center, with Commissary billings removed from the whole business", () => {
    expect(row(rows, "Net Sales").values).toEqual({ GGC: 9500_00, "The Nest": 4000_00, Shared: 0, Total: 13500_00 });
    expect(row(rows, "Total Cost of Goods Sold").values).toEqual({ GGC: -3600_00, "The Nest": 0, Shared: 0, Total: -3600_00 });
    expect(row(rows, "NET INCOME BEFORE TAX").values.Total).toBe(13500_00 - 3600_00 - 200_00 - 100_00 - 50_00);
    expect(row(rows, "Gross margin %").values.Total).toBe(Math.round((9900 / 13500) * 10000));
    expect(rows.some((r) => r.label.includes("Transfer Billings"))).toBe(false);
  });
  it("the Commissary book keeps its billings; the Nest export has no Shared items", () => {
    const comm = incomeStatement(totals, accounts, "commissary", ["Amount"], () => ["Amount"]);
    expect(row(comm, "Net Sales").values.Amount).toBe(800_00);
    const nest = incomeStatement(totals, accounts, "nest", ["Amount"], () => ["Amount"]);
    expect(row(nest, "NET INCOME BEFORE TAX").values.Amount).toBe(3800_00);
  });
  it("month by month with a year-to-date column", () => {
    const two = [...totals, st("4100", "Store", "GGC", 0, 1000, false, "2027-02")];
    const r = incomeStatement(two, accounts, "business", ["2027-02", "2027-03", "YTD"], (t) => [t.period_key, "YTD"]);
    expect(row(r, "Net Sales").values).toEqual({ "2027-02": 1000_00, "2027-03": 13500_00, YTD: 14500_00 });
  });
});

const at = (book: "Store" | "Commissary", code: string, balance: number): AccountTotal => ({
  book, account_code: code, prior_debit: 0, prior_credit: 0, year_debit: Math.max(balance, 0), year_credit: Math.max(-balance, 0),
});

describe("balance sheet", () => {
  const tb = [
    at("Store", "1110", 5000), at("Store", "1140", 20000), at("Store", "1520", 18000), at("Store", "2210", -24000),
    at("Store", "2250", -500), at("Store", "3100", -10000), at("Store", "4100", -9000), at("Store", "5130", 500),
    at("Commissary", "1280", 800), at("Store", "2180", -800), at("Store", "1150", 0),
  ];
  const col = balanceSheetColumn(tb, accounts, "Combined", new Map([["2210", 12000_00]]));
  const rows = balanceSheet([{ key: "now", data: col }]);
  const v = (label: string) => rows.find((r) => r.label === label)?.values.now;
  it("balances, splits loans by when they're due, and nets the Store and Commissary", () => {
    expect(v("TOTAL ASSETS")).toBe(43000_00);
    expect(v("TOTAL LIABILITIES AND EQUITY")).toBe(-43000_00);
    expect(v("Loans payable – due within 12 months")).toBe(-12000_00);
    expect(v("Loans payable – due after 12 months")).toBe(-12000_00);
    expect(v("Accrued interest payable")).toBe(-500_00);
    expect(v("Net income, year to date")).toBe(-8500_00);
    expect(v("Due from Store")).toBeUndefined();
  });
});

describe("cash flow (direct)", () => {
  const cash = new Set(cashAccounts(list, ["Store", "Commissary"]));
  const l = (id: number, code: string, d: number, c: number, book: "Store" | "Commissary" = "Store"): CashLine => ({ entry_id: id, entry_date: "2027-03-01", book, account_code: code, debit: d, credit: c });
  const lines = [
    l(1, "1110", 900, 0), l(1, "4181", 100, 0), l(1, "4100", 0, 1000), // cash sales net of discounts
    l(2, "1140", 0, 15000), l(2, "1520", 45000, 0), l(2, "2100", 0, 30000), // asset partly on credit
    l(3, "1140", 0, 19386.67), l(3, "2210", 14386.67, 0), l(3, "7510", 5000, 0), // installment
    l(4, "1140", 5000, 0), l(4, "1110", 0, 5000), // deposit: no flow
    l(5, "1140", 0, 2000), l(5, "2180", 2000, 0), l(6, "1145", 2000, 0, "Commissary"), l(6, "1280", 0, 2000, "Commissary"),
  ];
  it("categorizes each cash movement by what it paid for", () => {
    const f = cashFlows(lines, accounts, cash);
    expect(f.get("sales")).toBe(900_00);
    expect(f.get("assets")).toBe(-15000_00);
    expect(f.get("loans")).toBe(-14386_67);
    expect(f.get("interest")).toBe(-5000_00);
    expect(f.has("transfers")).toBe(false);
    expect(f.get("intercompany")).toBe(0);
  });
  it("one account at a time: transfers with other cash accounts show", () => {
    const f = cashFlows(lines, accounts, new Set(["1140"]));
    expect(f.get("transfers")).toBe(5000_00);
    expect(f.get("intercompany")).toBe(-2000_00);
  });
});
