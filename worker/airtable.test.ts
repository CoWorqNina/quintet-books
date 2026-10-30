import { describe, expect, it } from "vitest";
import { toAccount } from "./airtable";

describe("toAccount", () => {
  it("maps Airtable fields", () => {
    const a = toAccount({
      id: "rec1",
      createdTime: "",
      fields: {
        Code: "1110",
        Name: "Cash on Hand – For Deposit",
        Type: "Asset",
        "Normal Balance": "Dr",
        Book: "Store",
        "Cash Flow Group": "Cash",
        Statement: "Balance Sheet",
        "Statement Line": "Cash & Cash Equivalents",
        "Is Cash Account": true,
        Active: true,
      },
    });
    expect(a).toMatchObject({ code: "1110", isCashAccount: true, isHeader: false, active: true, subLedger: null });
  });

  it("treats unchecked checkboxes (omitted by Airtable) as false and infers the statement", () => {
    const a = toAccount({ id: "rec2", createdTime: "", fields: { Code: "6100", Name: "Salaries" } });
    expect(a).toMatchObject({ active: false, isHeader: false, statement: "Income Statement", statementLine: "Salaries" });
  });
});
