import { describe, expect, it } from "vitest";
import { bucketOf, type PayableItem, toPay, weeklyPlan } from "./payables";

const item = (dueDate: string | null, openCents: number, pendingCents = 0): PayableItem => ({
  key: `${dueDate}-${openCents}`, kind: "supplier", book: "Store", accountCode: "2100", accountName: "AP", payee: "MDEI", label: "x",
  date: "2026-10-31", dueDate, openCents, pendingCents,
});

describe("payables planner", () => {
  it("groups by due date relative to today", () => {
    const today = "2026-11-02";
    expect(["2026-10-27", "2026-11-02", "2026-11-09", "2026-11-10", "2026-12-02", "2026-12-03", null].map((d) => bucketOf(d, today))).toEqual([
      "overdue", "week", "week", "month", "month", "later", "none",
    ]);
  });

  it("weekly plan runs cash down week by week; pending payments are already counted", () => {
    const items = [item("2026-10-27", 8550_00), item("2026-11-04", 52819_13), item("2026-11-12", 7876_00, 876_00), item("2027-04-19", 2298_44), item(null, 73139_25)];
    expect(toPay(items[2])).toBe(7000_00);
    const plan = weeklyPlan(items, 100000_00, "2026-11-02", 2);
    expect(plan.map((r) => [r.label, r.from, r.to, r.dueCents, r.cashAfterCents])).toEqual([
      ["Overdue", null, "2026-11-01", 8550_00, 91450_00],
      ["This week", "2026-11-02", "2026-11-08", 52819_13, 38630_87],
      ["Week 2", "2026-11-09", "2026-11-15", 7000_00, 31630_87],
      ["Later", "2026-11-16", null, 2298_44, 29332_43],
      ["No due date", null, null, 73139_25, -43806_82],
    ]);
  });
});
