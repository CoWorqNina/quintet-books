import { describe, expect, it } from "vitest";
import { bearerToken } from "./auth";

describe("bearerToken", () => {
  it("reads a bearer token", () => expect(bearerToken("Bearer abc.def")).toBe("abc.def"));
  it("is case-insensitive on the scheme", () => expect(bearerToken("bearer x")).toBe("x"));
  it("rejects missing or malformed headers", () => {
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken("Bearer")).toBeNull();
  });
});
