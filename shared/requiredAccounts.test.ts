/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { REQUIRED_ACCOUNTS } from "./requiredAccounts";

const sources = import.meta.glob(["./**/*.ts", "!./**/*.test.ts", "!./requiredAccounts.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("required accounts", () => {
  it("lists every account code the shared code uses", () => {
    const used = new Set(Object.values(sources).flatMap((src) => [...src.matchAll(/"([1-9]\d{3})"/g)].map((m) => m[1])));
    used.delete("6549"); // upper bound of a range, not an account
    expect(used.size).toBeGreaterThan(50);
    expect([...used].filter((c) => !REQUIRED_ACCOUNTS.has(c))).toEqual([]);
  });
});
