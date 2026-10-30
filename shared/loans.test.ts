import { describe, expect, it } from "vitest";
import { addMonths, buildSchedule } from "./loans";

describe("loan schedules", () => {
  it("UB loan: ₱400,000 in 24 installments of ₱19,386.67", () => {
    const s = buildSchedule({ principalCents: 400000_00, months: 24, firstDue: "2026-05-15", installmentCents: 19386_67 });
    expect(s.installments).toHaveLength(24);
    expect(s.installments.reduce((t, i) => t + i.principalCents, 0)).toBe(400000_00);
    for (const i of s.installments.slice(0, 23)) expect(i.principalCents + i.interestCents).toBe(19386_67);
    expect(Math.abs(s.installments[23].principalCents + s.installments[23].interestCents - 19386_67)).toBeLessThanOrEqual(5);
    expect(s.annualRatePct).toBeGreaterThan(14);
    expect(s.annualRatePct).toBeLessThan(15);
    expect(s.installments[0].interestCents).toBeGreaterThan(s.installments[23].interestCents);
  });

  it("from an annual rate, and interest-free", () => {
    const s = buildSchedule({ principalCents: 100000_00, months: 2, firstDue: "2026-12-02", annualRatePct: 12 });
    expect(s.installments.map((i) => [i.dueDate, i.principalCents, i.interestCents])).toEqual([
      ["2026-12-02", 49751_24, 1000_00],
      ["2027-01-02", 50248_76, 502_49],
    ]);
    const free = buildSchedule({ principalCents: 30000_00, months: 3, firstDue: "2026-12-31" });
    expect(free.installments.map((i) => [i.dueDate, i.principalCents, i.interestCents])).toEqual([
      ["2026-12-31", 10000_00, 0],
      ["2027-01-31", 10000_00, 0],
      ["2027-02-28", 10000_00, 0],
    ]);
  });

  it("keeps the due day, clamped to short months", () => {
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });
});
