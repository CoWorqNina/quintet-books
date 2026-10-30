import { DUE_TO_COMMISSARY } from "../shared/templates/commissary";
import type { Template, TemplateContext } from "../shared/templates";
import type { AppUser, Book } from "../shared/types";
import { checkProfitCenter } from "./access";
import { getAccounts, getParties, getProducts } from "./airtable";
import { accountBalanceCents } from "./balances";
import { badRequest, forbidden } from "./db";
import type { Env } from "./env";
import { getLoans } from "./registers";
import { serviceClient } from "./supabase";

/**
 * Checks the caller may post this template in this book and profit center, and loads what the
 * template needs. Commissary entries are always tagged GGC. Two-book templates need access to
 * either book (e.g. the Commissary In-charge bills the Store).
 */
export async function templateContext(
  env: Env,
  user: AppUser,
  template: Template,
  book: Book,
  profitCenter: "GGC" | "The Nest",
): Promise<TemplateContext> {
  if (book !== "Store" && book !== "Commissary") badRequest("Choose the Store or Commissary book.");
  if (template.twoBook) {
    if (!template.books.some((b) => user.books.includes(b))) forbidden("You don't have access to these books.");
    if (profitCenter !== "GGC" && profitCenter !== "The Nest") badRequest("Choose GGC or The Nest.");
  } else {
    if (!user.books.includes(book)) forbidden(`You don't have access to the ${book} book.`);
    if (book === "Store") checkProfitCenter(user, profitCenter);
  }
  const uses = (type: string) => template.fields.some((f) => f.type === type || f.columns?.some((c) => c.type === type));
  const db = serviceClient(env);
  const [accounts, parties, products, loans, dueTo] = await Promise.all([
    getAccounts(env),
    getParties(env),
    uses("product") ? getProducts(env) : Promise.resolve([]),
    uses("loan") ? getLoans(db) : Promise.resolve([]),
    template.number === 21 ? accountBalanceCents(db, "Store", DUE_TO_COMMISSARY) : Promise.resolve(undefined),
  ]);
  return {
    book: template.twoBook ? "Store" : book,
    profitCenter: book === "Commissary" && !template.twoBook ? "GGC" : profitCenter,
    accounts: new Map(accounts.map((a) => [a.code, a])),
    parties: new Map(parties.map((p) => [p.id, p])),
    products: new Map(products.map((p) => [p.id, p])),
    loans: new Map(loans.map((l) => [String(l.id), l])),
    dueToCommissaryCents: dueTo === undefined ? undefined : -dueTo,
  };
}
