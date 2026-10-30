import { describe, expect, it } from "vitest";
import { buildClassification, buildManualEntry } from "./manual";
import testAccounts from "./test-accounts.json";
import type { Account } from "./types";

const accounts = new Map((testAccounts as Account[]).map((a) => [a.code, a]));
const base = { kind: "Special" as const, book: "Store" as const, date: "2026-11-10", description: "Fix", reason: "Wrong account" };

describe("manual entries", () => {
  it("balanced lines with profit centers on income statement accounts", () => {
    const r = buildManualEntry(
      { ...base, lines: [{ account: "6610", debit: 500, profitCenter: "The Nest" }, { account: "1110", credit: 500 }] },
      accounts,
      new Map(),
    );
    expect(r.errors).toEqual([]);
    expect(r.entry!.lines.map((l) => [l.account_code, l.debitCents, l.creditCents, l.profit_center])).toEqual([
      ["6610", 500_00, 0, "The Nest"],
      ["1110", 0, 500_00, null],
    ]);
  });

  it("rejects unbalanced entries, missing reasons and profit centers", () => {
    const r = buildManualEntry({ ...base, reason: "", lines: [{ account: "6610", debit: 500 }, { account: "1110", credit: 400 }] }, accounts, new Map());
    expect(r.entry).toBeNull();
    expect(r.errors.join(" | ")).toMatch(/reason.*choose.*must be equal/s);
  });

  it("opening balances are balance sheet accounts on Oct 31", () => {
    const r = buildManualEntry(
      { ...base, kind: "Opening", date: "2026-10-31", lines: [{ account: "1110", debit: 1000 }, { account: "6610", credit: 1000, profitCenter: "GGC" }] },
      accounts,
      new Map(),
    );
    expect(r.errors.join()).toMatch(/balance sheet accounts only/);
    const ok = buildManualEntry({ ...base, kind: "Opening", date: "2026-10-31", lines: [{ account: "1110", debit: 1000 }, { account: "3100", credit: 1000 }] }, accounts, new Map());
    expect(ok.entry).toMatchObject({ kind: "Opening", transaction_type: 43 });
  });
});

describe("classification", () => {
  const original = { id: 9, book: "Store" as const, date: "2026-11-03", amountCents: 1500_00, moneyOut: true, description: "Cash out" };
  it("moves money out of suspense into the real accounts", () => {
    const r = buildClassification(
      original,
      { date: "2026-11-12", reason: "Was a staff meal and LPG", lines: [{ account: "6610", amount: 1000, profitCenter: "GGC" }, { account: "1241", amount: 500 }] },
      accounts,
    );
    expect(r.errors).toEqual([]);
    expect(r.entry!.classifies_entry_id).toBe(9);
    expect(r.entry!.lines.map((l) => [l.account_code, l.debitCents, l.creditCents])).toEqual([
      ["6610", 1000_00, 0],
      ["1241", 500_00, 0],
      ["1195", 0, 1500_00],
    ]);
  });
  it("must add up to the original amount", () => {
    const r = buildClassification(original, { date: "2026-11-12", reason: "x", lines: [{ account: "1241", amount: 100 }] }, accounts);
    expect(r.errors.join()).toMatch(/must add up/);
  });
});
