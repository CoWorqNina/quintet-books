import { describe, expect, it } from "vitest";
import { checkEntryDate, todayManila } from "./access";

describe("entry dates", () => {
  const now = new Date("2026-11-05T20:00:00Z"); // Nov 6, 4 AM in Manila
  it("uses Manila time", () => expect(todayManila(now)).toBe("2026-11-06"));
  it("allows go-live through today", () => {
    expect(() => checkEntryDate("2026-11-01", now)).not.toThrow();
    expect(() => checkEntryDate("2026-11-06", now)).not.toThrow();
  });
  it("rejects dates before go-live or in the future", () => {
    expect(() => checkEntryDate("2026-10-29", now)).toThrow(/November 1, 2026/);
    expect(() => checkEntryDate("2026-11-07", now)).toThrow(/future/);
  });
});
