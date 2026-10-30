import { describe, expect, it } from "vitest";
import { bucketize, openItems, type PartyLine, trialBalance, trialBalanceTotals } from "./ledger";
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
});
