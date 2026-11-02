import { describe, expect, it } from "vitest";
import { allocate, summarize } from "./cash";

const L = (entry_id: number, account_code: string, debit: number, credit: number) => ({ entry_id, account_code, debit, credit });
const isCash = (c: string) => ["1110", "1140", "1150"].includes(c);

describe("where cash came from and went to", () => {
  it("shares a cash line over the other side of the entry", () => {
    // payout: bank 11,190.07 + fees 286.93 = card clearing 11,477
    const a = allocate([L(1, "1140", 11190.07, 0), L(1, "6555", 286.93, 0), L(1, "1181", 0, 11477)], isCash);
    expect(a).toEqual([{ entryId: 1, account: "1140", against: "1181", cents: 11190_07 }]);
    // purchase paid from GCash, two expense lines
    const p = allocate([L(2, "5130", 300, 0), L(2, "6610", 100, 0), L(2, "1150", 0, 400)], isCash);
    expect(p.map((x) => [x.against, x.cents])).toEqual([["5130", -300_00], ["6610", -100_00]]);
  });

  it("a transfer shows on both accounts against each other", () => {
    const a = allocate([L(3, "1140", 5000, 0), L(3, "1110", 0, 5000)], isCash);
    expect(a.map((x) => [x.account, x.against, x.cents])).toEqual([["1140", "1110", 5000_00], ["1110", "1140", -5000_00]]);
    expect(summarize(a.filter((x) => x.account === "1140")).inflows).toEqual([{ against: "1110", cents: 5000_00 }]);
  });

  it("rounding is absorbed by the last share", () => {
    const a = allocate([L(4, "1140", 0, 100), L(4, "6610", 33.33, 0), L(4, "6620", 33.33, 0), L(4, "6630", 33.34, 0)], isCash);
    expect(a.reduce((s, x) => s + x.cents, 0)).toBe(-100_00);
  });
});
