import type { TemplateContext } from "../shared/templates";
import type { AppUser, Book } from "../shared/types";
import { checkProfitCenter } from "./access";
import { getAccounts, getParties } from "./airtable";
import { badRequest, forbidden } from "./db";
import type { Env } from "./env";

/**
 * Checks the caller may post in this book and profit center and loads what templates need.
 * Commissary entries are always tagged GGC.
 */
export async function templateContext(
  env: Env,
  user: AppUser,
  book: Book,
  profitCenter: "GGC" | "The Nest",
): Promise<TemplateContext> {
  if (book !== "Store" && book !== "Commissary") badRequest("Choose the Store or Commissary book.");
  if (!user.books.includes(book)) forbidden(`You don't have access to the ${book} book.`);
  if (book === "Store") checkProfitCenter(user, profitCenter);
  const [accounts, parties] = await Promise.all([getAccounts(env), getParties(env)]);
  return {
    book,
    profitCenter: book === "Commissary" ? "GGC" : profitCenter,
    accounts: new Map(accounts.map((a) => [a.code, a])),
    parties: new Map(parties.map((p) => [p.id, p])),
  };
}
