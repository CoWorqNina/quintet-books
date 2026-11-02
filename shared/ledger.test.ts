import { describe, expect, it } from "vitest";
import { bucketize, openBills, openItems, type PartyLine, trialBalance, trialBalanceTotals } from "./ledger";
import testAccounts from "./test-accounts.json";
import type { Account } from "./types";

const accounts = new Map((testAccounts as Account[]).map((a) => [a.code, a]));
const t = (book: "Store" | "Commissary", code: string, pd: number, pc: number, yd: number, yc: number) => ({
  book, account_code: code, prior_debit: pd, prior_credit: pc, year_debit: yd, year_credit: yc,
});

describe("trial balance", () => {
  it("carries balance sheet accounts, takes income year-to-date, and closes earlier years into retained earnings", () => {
    const totals = [t("Store", "1110", 5000, 0, 1000, 0), t("Store", "4100", 0, 5000, 0, 1000), t("Commissary", "1140", 200, 0, 0, 0), t("Commissary", "3100", 0, 200, 0, 0)];
    const store = trialBalance(totals, accounts, "Store");
    expect(store.map((r) => [r.code, r.balanceCents])).toEqual([
      ["1110", 6000_00],
      ["3300", -5000_00],
      ["4100", -1000_00],
    ]);
    const tot = trialBalanceTotals(trialBalance(totals, accounts, "Combined"));
    expect(tot.debitCents).toBe(tot.creditCents);
    expect(tot.debitCents).toBe(6200_00);
  });
});

describe("aging", () => {
  const l = (date: string, debit: number, credit: number, id: number): PartyLine => ({
    book: "Store", account_code: "2100", party_id: "recSup", party_name: "Davao Poultry", entry_id: id, entry_date: date, description: null, debit, credit,
  });
  it("payments settle the oldest bills first", () => {
    const r = openItems([l("2026-11-01", 0, 1000, 1), l("2026-12-05", 0, 500, 2), l("2026-12-10", 700, 0, 3)], "credit", "2026-12-31");
    expect(r.items.map((i) => [i.entryId, i.openCents, i.ageDays])).toEqual([
      [1, 300_00, 60],
      [2, 500_00, 26],
    ]);
    expect(r.balanceCents).toBe(800_00);
    expect(bucketize(r.items)).toEqual([500_00, 300_00, 0, 0]);
  });
  it("a payment ahead of the bill is applied when the bill arrives", () => {
    const r = openItems([l("2026-11-01", 400, 0, 1), l("2026-11-03", 0, 1000, 2)], "credit", "2026-11-10");
    expect(r.items[0].openCents).toBe(600_00);
    expect(r.balanceCents).toBe(600_00);
  });

  const n = (date: string, debit: number, credit: number, id: number, lineId: number, settles: number | null = null, due: string | null = null): PartyLine => ({
    ...l(date, debit, credit, id), line_id: lineId, settles_line_id: settles, due_date: due,
  });
  it("a payment naming a bill settles that bill, not the oldest", () => {
    const r = openItems([n("2026-11-01", 0, 1000, 1, 10), n("2026-11-05", 0, 500, 2, 20, null, "2026-11-20"), n("2026-11-06", 500, 0, 3, 30, 20)], "credit", "2026-11-25");
    expect(r.items.map((i) => [i.lineId, i.openCents])).toEqual([[10, 1000_00]]);
    expect(r.balanceCents).toBe(1000_00);
  });
  it("part payment of a named bill; an over-payment spills to the oldest bills", () => {
    const r = openItems([n("2026-11-01", 0, 1000, 1, 10), n("2026-11-05", 0, 500, 2, 20, null, "2026-11-20"), n("2026-11-06", 600, 0, 3, 30, 20)], "credit", "2026-11-25");
    expect(r.items.map((i) => [i.lineId, i.openCents, i.overdueDays])).toEqual([[10, 900_00, 0]]);
    const p = openItems([n("2026-11-01", 0, 1000, 1, 10), n("2026-11-05", 0, 500, 2, 20, null, "2026-11-20"), n("2026-11-06", 200, 0, 3, 30, 20)], "credit", "2026-11-25");
    expect(p.items.map((i) => [i.lineId, i.openCents, i.overdueDays])).toEqual([
      [10, 1000_00, 0],
      [20, 300_00, 5],
    ]);
  });
  it("open bills per supplier, with payments waiting for approval", () => {
    const other = { ...n("2026-11-02", 0, 300, 4, 40), party_id: "recOther", party_name: "Other" };
    const bills = openBills([n("2026-11-01", 0, 1000, 1, 10), other, n("2026-11-03", 300, 0, 5, 50)], [{ settles_line_id: 10, amount: "250.00" }], "2026-11-10", (c) => c === "2100");
    // the unnamed ₱300 payment settles Davao Poultry's own oldest bill, not Other's
    expect(bills.map((b) => [b.lineId, b.party, b.openCents, b.pendingCents])).toEqual([
      [10, "Davao Poultry", 700_00, 250_00],
      [40, "Other", 300_00, 0],
    ]);
  });
});
