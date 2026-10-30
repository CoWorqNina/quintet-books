import { describe, expect, it } from "vitest";
import { looksSimilar } from "./similar";

describe("looksSimilar", () => {
  it("flags likely duplicates", () => {
    expect(looksSimilar("Davao Poultry Inc.", "davao poultry")).toBe(true);
    expect(looksSimilar("Gaisano Mall", "Gaisano Mal")).toBe(true);
    expect(looksSimilar("S&R", "S & R Membership Shopping")).toBe(true);
  });
  it("leaves different names alone", () => {
    expect(looksSimilar("Davao Poultry", "Mindanao Rice")).toBe(false);
    expect(looksSimilar("Ana", "Ben")).toBe(false);
  });
});
