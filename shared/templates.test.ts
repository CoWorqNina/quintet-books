import { describe, expect, it } from "vitest";
import { isBalanced } from "./entries";
import { getTemplate, type TemplateContext } from "./templates";
import type { Account } from "./types";
import testAccounts from "./test-accounts.json";

const ctx: TemplateContext = { profitCenter: "GGC", accounts: new Map((testAccounts as Account[]).map((a) => [a.code, a])) };
const photo = { path: "p", name: "p.jpg", type: "image/jpeg", size: 1 };
const build = (n: number, values: Record<string, unknown>, c = ctx) => getTemplate(n)!.build(values as never, c);

describe("standalone templates", () => {
  it("#7 card payout: bank net, fees, clearing gross", () => {
    const r = build(7, { date: "2026-11-03", bank: "1140", gross: 11477, fees: 286.93, reference: "SB123" });
    expect(r.errors).toEqual([]);
    expect(isBalanced(r.entry!)).toBe(true);
    expect(r.entry!.lines.map((l) => [l.account_code, l.debitCents, l.creditCents])).toEqual([
      ["1140", 11190_07, 0],
      ["6555", 286_93, 0],
      ["1181", 0, 11477_00],
    ]);
  });

  it("#8 platform payout splits commission, deductions and withholding tax", () => {
    const r = build(8, { date: "2026-11-07", platform: "Grab", receivedIn: "1140", gross: 10000, commission: 2500, deductions: 100, withholding: 50, reference: "W45", proof: photo });
    expect(r.errors).toEqual([]);
    expect(isBalanced(r.entry!)).toBe(true);
    expect(r.entry!.lines.find((l) => l.account_code === "1140")!.debitCents).toBe(7350_00);
    expect(r.entry!.lines.find((l) => l.account_code === "1182")!.creditCents).toBe(10000_00);
  });

  it("#8 needs the weekly statement", () => {
    const r = build(8, { date: "2026-11-07", platform: "Grab", receivedIn: "1140", gross: 100, reference: "x" });
    expect(r.errors).toContain("Weekly platform statement is required.");
  });

  it("#9 deposit and #10 transfer", () => {
    expect(isBalanced(build(9, { date: "2026-11-03", bank: "1140", amount: 18000, reference: "DS1", proof: photo }).entry!)).toBe(true);
    const t = build(10, { date: "2026-11-03", from: "1110", to: "1110", amount: 5, fromReference: "a", toReference: "b" });
    expect(t.errors).toContain("Sending and receiving accounts must differ.");
  });

  it("#5 pop-up sales record the event and gross up discounts", () => {
    const r = build(5, { date: "2026-11-08", event: "Abreeza bazaar", channel: "cash", amount: 950, discounts: 50, discountAccount: "4181" });
    expect(r.errors).toEqual([]);
    expect(r.entry!.lines.find((l) => l.template_line === "5.sales")).toMatchObject({ creditCents: 1000_00, party_name: "Abreeza bazaar" });
  });

  it("#11 petty cash expense rules", () => {
    expect(build(11, { date: "2026-11-03", description: "Chicken", account: "5130", amount: 500, receipt: photo }).errors).toContain(
      "Ingredients need quantity, unit and unit price.",
    );
    const ok = build(11, { date: "2026-11-03", description: "Tissue", account: "6610", amount: 80, noReceiptApproved: true });
    expect(ok.errors).toEqual([]);
    expect(ok.entry!.unsupported).toBe(true);
    expect(build(11, { date: "2026-11-03", description: "Sauces", account: "4100", amount: 80, receipt: photo }).errors).toContain(
      "Choose an expense or ingredient account.",
    );
  });

  it("deposits go to any bank or e-wallet: The Nest's cash into GoTyme", () => {
    const r = build(9, { date: "2026-11-03", bank: "1170", amount: 5000, reference: "x", proof: photo }, { ...ctx, profitCenter: "The Nest" });
    expect(r.errors).toEqual([]);
    expect(r.entry!.lines.map((l) => [l.account_code, l.debitCents, l.creditCents])).toEqual([
      ["1170", 5000_00, 0],
      ["1156", 0, 5000_00],
    ]);
    expect(build(9, { date: "2026-11-03", bank: "1110", amount: 1, reference: "x", proof: photo }).errors).toContain(
      "Deposited to: choose a bank or e-wallet account.",
    );
  });
});
