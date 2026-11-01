import { describe, expect, it } from "vitest";
import { addMonths, buildSchedule } from "./loans";

describe("straight-line loan schedules", () => {
  it("UB (Nj card): ₱400,000, 24 × ₱19,386.67", () => {
    const s = buildSchedule({ principalCents: 400000_00, months: 24, firstDue: "2026-04-12", installmentCents: 19386_67 });
    expect(s.errors).toEqual([]);
    expect(s.totalInterestCents).toBe(65280_08);
    expect([s.interestPerMonthCents, s.principalPerMonthCents]).toEqual([2720_00, 16666_67]);
    expect(s.installments[23]).toMatchObject({ seq: 24, interestCents: 2720_08, principalCents: 16666_59, dueDate: "2028-03-12" });
    expect(s.installments[7].dueDate).toBe("2026-11-12");
    for (const i of s.installments) expect(i.principalCents + i.interestCents).toBe(19386_67);
  });

  it("RCBC (Nina card): ₱163,000, 60 × ₱3,377.29", () => {
    const s = buildSchedule({ principalCents: 163000_00, months: 60, firstDue: "2026-05-25", installmentCents: 3377_29 });
    expect(s.errors).toEqual([]);
    expect(s.totalInterestCents).toBe(39637_40);
    expect([s.interestPerMonthCents, s.principalPerMonthCents]).toEqual([660_62, 2716_67]);
    expect(s.installments[59]).toMatchObject({ interestCents: 660_82, principalCents: 2716_47 });
    expect(s.installments[5].dueDate).toBe("2026-10-25");
  });

  it("rejects a loan whose rows wouldn't pay exactly the installment", () => {
    // 100.01 over 2 months at 60.00: principal 50.01 + interest 10.00 = 60.01 per row
    const s = buildSchedule({ principalCents: 100_01, months: 2, firstDue: "2026-12-01", installmentCents: 60_00 });
    expect(s.errors.join()).toMatch(/don't add up to the installment/);
    expect(buildSchedule({ principalCents: 100000_00, months: 3, firstDue: "2026-12-01", installmentCents: 30000_00 }).errors.join()).toMatch(/less than the principal/);
  });

  it("keeps the due day, clamped to short months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
  });
});
