import { GO_LIVE_DATE } from "../shared/config";
import type { AppUser, ProfitCenter } from "../shared/types";
import { badRequest, forbidden } from "./db";

/** Today's date in the Philippines (UTC+8, no daylight saving). */
export function todayManila(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

export function checkEntryDate(date: string, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) badRequest("Enter a valid date.");
  if (date < GO_LIVE_DATE) badRequest("Entries start on November 1, 2026 (go-live). Earlier months stay in the manual records.");
  if (date > todayManila(now)) badRequest("The date can't be in the future.");
}

export function checkProfitCenter(user: AppUser, pc: ProfitCenter | string) {
  if (pc !== "GGC" && pc !== "The Nest") badRequest("Choose GGC or The Nest.");
  if (!user.profitCenters.includes(pc)) forbidden(`You can't enter ${pc} transactions.`);
  if (!user.books.includes("Store")) forbidden("You don't have access to the Store book.");
}

export const isOwner = (u: AppUser) => u.role === "Owner";
export const seesEverything = (u: AppUser) => u.role === "Owner" || u.role === "Accountant";

/**
 * Applies the role's visibility to an entries or daily_reports query:
 * Owner/Accountant everything; Supervisor their books and profit centers;
 * Staff only their own; Commissary In-charge only Commissary entries.
 */
export function scopeQuery<Q extends { eq(c: string, v: unknown): Q; in(c: string, v: unknown[]): Q }>(
  query: Q,
  user: AppUser,
  opts: { hasBook?: boolean } = { hasBook: true },
): Q {
  switch (user.role) {
    case "Owner":
    case "Accountant":
      return query;
    case "Supervisor":
      return (opts.hasBook ? query.in("book", user.books) : query).in("profit_center", user.profitCenters);
    case "Commissary In-charge":
      return opts.hasBook ? query.eq("book", "Commissary") : query.eq("created_by", user.id);
    default:
      return query.eq("created_by", user.id);
  }
}
