import { describe, expect, it } from "vitest";
import { isBalanced } from "./entries";
import { closingEntry } from "./yearEnd";
import testAccounts from "./test-accounts.json";
import type { Account } from "./types";

const accounts = new Map((testAccounts as Account[]).map((a) => [a.code, a]));
const t = (code: string, pc: "GGC" | "The Nest" | null, d: number, c: number, book: "Store" | "Commissary" = "Store") => ({
  book, account_code: code, profit_center: pc, prior_debit: 0, prior_credit: 0, year_debit: d, year_credit: c,
});

describe("year-end close", () => {
  it("zeroes every income and expense account per profit center into retained earnings", () => {
    const e = closingEntry(2026, "Store", [t("4100", "GGC", 0, 9000), t("4100", "The Nest", 0, 3000), t("5130", "GGC", 4000, 0), t("1110", null, 5000, 0), t("4100", "GGC", 0, 1, "Commissary")], accounts)!;
    expect(e.entry_date).toBe("2026-12-31");
    expect(e.lines.map((l) => [l.account_code, l.profit_center ?? null, l.debitCents, l.creditCents])).toEqual([
      ["4100", "GGC", 9000_00, 0],
      ["4100", "The Nest", 3000_00, 0],
      ["5130", "GGC", 0, 4000_00],
      ["3300", null, 0, 8000_00],
    ]);
    expect(isBalanced(e)).toBe(true);
  });
  it("a net loss debits retained earnings; nothing left means no entry", () => {
    expect(closingEntry(2026, "Commissary", [t("6610", "GGC", 700, 0, "Commissary")], accounts)!.lines.at(-1)).toMatchObject({ account_code: "3300", debitCents: 700_00 });
    expect(closingEntry(2026, "Store", [t("4100", "GGC", 500, 500)], accounts)).toBeNull();
  });
});
