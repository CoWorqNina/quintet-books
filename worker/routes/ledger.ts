import { Hono } from "hono";
import {
  AGE_BUCKETS,
  type AccountTotal,
  bucketize,
  CLEARING_ACCOUNTS,
  CLEARING_LIMIT_DAYS,
  groupBy,
  INGREDIENT_ACCOUNTS,
  monthEnd,
  openItems,
  type PartyLine,
  trialBalance,
  type TrialBalanceMode,
  trialBalanceTotals,
  yearStart,
} from "../../shared/ledger";
import { toCents } from "../../shared/money";
import type { Account, Book } from "../../shared/types";
import { seesEverything, todayManila } from "../access";
import { getAccounts } from "../airtable";
import { badRequest, dbError, forbidden } from "../db";
import type { AppContext } from "../env";
import { loadRegisters } from "../monthEnd";
import { serviceClient } from "../supabase";

// Read-only accounting cycle views and sub-ledgers (Owner and Accountant).
export const ledger = new Hono<AppContext>();

ledger.use("/*", async (c, next) => {
  if (!seesEverything(c.get("user"))) forbidden("Only an Owner or the Accountant sees the ledger views.");
  await next();
});

const isDate = (d: string | undefined): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
const isPeriod = (p: string | undefined): p is string => !!p && /^\d{4}-\d{2}$/.test(p);
function bookParam(v: string | undefined): Book | null {
  if (!v || v === "Combined") return null;
  if (v !== "Store" && v !== "Commissary") badRequest("Choose Store, Commissary or Combined.");
  return v;
}
const accountMap = async (env: AppContext["Bindings"]) => new Map((await getAccounts(env)).map((a) => [a.code, a]));

ledger.get("/trial-balance", async (c) => {
  const period = c.req.query("period") ?? todayManila().slice(0, 7);
  if (!isPeriod(period)) badRequest("Choose a month.");
  const mode = (c.req.query("mode") ?? "adjusted") as TrialBalanceMode;
  if (!["unadjusted", "adjusted", "post-closing"].includes(mode)) badRequest("Unknown trial balance.");
  const view = (c.req.query("book") ?? "Combined") as Book | "Combined";
  bookParam(view);
  const asOf = monthEnd(period);
  const db = serviceClient(c.env);
  const [{ data, error }, accounts, periodRow] = await Promise.all([
    db.rpc("account_totals", { p_to: asOf, p_year_start: yearStart(asOf), p_mode: mode }),
    accountMap(c.env),
    db.from("periods").select("status").eq("key", period).maybeSingle(),
  ]);
  dbError(error);
  const rows = trialBalance((data ?? []) as AccountTotal[], accounts, view);
  return c.json({ period, asOf, mode, book: view, status: periodRow.data?.status ?? null, rows, totals: trialBalanceTotals(rows) });
});

// General Ledger / T-account for one account: opening balance, lines and running balance.
ledger.get("/account", async (c) => {
  const code = c.req.query("account") ?? "";
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (!isDate(from) || !isDate(to) || from > to) badRequest("Choose a date range.");
  const book = bookParam(c.req.query("book"));
  const accounts = await accountMap(c.env);
  const account = accounts.get(code);
  if (!account || account.isHeader) badRequest("Choose an account.");
  const income = account.statement === "Income Statement";
  const db = serviceClient(c.env);
  const [opening, lines] = await Promise.all([
    db.rpc("gl_opening", { p_account: code, p_book: book, p_before: from, p_since: income ? yearStart(from) : null }),
    db.rpc("gl_lines", { p_account: code, p_book: book, p_from: from, p_to: to }),
  ]);
  dbError(opening.error);
  dbError(lines.error);
  let running = toCents(Number(opening.data ?? 0));
  const openingCents = running;
  type Line = { entry_id: number; line_no: number; entry_date: string; kind: string; transaction_type: number | null; book: Book; description: string | null; source_document: string | null; profit_center: string | null; party_name: string | null; memo: string | null; debit: number; credit: number; attachments: unknown[] };
  const out = ((lines.data ?? []) as Line[]).map((l) => {
    const debitCents = toCents(Number(l.debit));
    const creditCents = toCents(Number(l.credit));
    running += debitCents - creditCents;
    return {
      entryId: l.entry_id,
      date: l.entry_date,
      kind: l.kind,
      transactionType: l.transaction_type,
      book: l.book,
      description: l.description,
      sourceDocument: l.source_document,
      profitCenter: l.profit_center,
      partyName: l.party_name,
      memo: l.memo,
      debitCents,
      creditCents,
      balanceCents: running,
      attachments: l.attachments ?? [],
    };
  });
  return c.json({
    account,
    book: book ?? "Combined",
    from,
    to,
    openingCents,
    openingNote: income ? `Year to date from ${yearStart(from)}` : null,
    lines: out,
    debitCents: out.reduce((s, l) => s + l.debitCents, 0),
    creditCents: out.reduce((s, l) => s + l.creditCents, 0),
    closingCents: running,
  });
});

async function partyLines(env: AppContext["Bindings"], codes: string[], asOf: string, book: Book | null): Promise<PartyLine[]> {
  const { data, error } = await serviceClient(env).rpc("party_lines", { p_accounts: codes, p_to: asOf });
  dbError(error);
  return ((data ?? []) as PartyLine[]).filter((l) => !book || l.book === book);
}

const children = (accounts: Map<string, Account>, parent: string) =>
  [...accounts.values()].filter((a) => a.parentCode === parent && !a.isHeader).map((a) => a.code);
const partyKey = (l: PartyLine) => l.party_id ?? `name:${l.party_name ?? ""}`;
const balance = (lines: PartyLine[], normal: "debit" | "credit") =>
  lines.reduce((s, l) => s + (normal === "debit" ? 1 : -1) * (toCents(Number(l.debit)) - toCents(Number(l.credit))), 0);

// Sub-ledgers: balances per supplier, employee, owner, person or clearing account.
ledger.get("/sub/:kind", async (c) => {
  const kind = c.req.param("kind");
  const asOf = c.req.query("asOf") ?? todayManila();
  if (!isDate(asOf)) badRequest("Choose a date.");
  const book = bookParam(c.req.query("book"));
  const accounts = await accountMap(c.env);
  const name = (code: string) => accounts.get(code)?.name ?? code;

  if (kind === "ap") {
    const lines = await partyLines(c.env, ["2100"], asOf, book);
    const parties = [...groupBy(lines, partyKey).values()].map((ls) => {
      const { items, balanceCents } = openItems(ls, "credit", asOf);
      return { party: ls[0].party_name ?? "(no supplier)", balanceCents, buckets: bucketize(items), items };
    });
    return c.json({ asOf, buckets: AGE_BUCKETS.map((b) => b.label), controlCents: balance(lines, "credit"), parties: parties.filter((p) => p.balanceCents).sort((a, b) => b.balanceCents - a.balanceCents) });
  }

  if (kind === "employees") {
    const codes = children(accounts, "1240");
    const lines = await partyLines(c.env, codes, asOf, book);
    const people = [...groupBy(lines, partyKey).values()].map((ls) => ({
      party: ls[0].party_name ?? "(no employee)",
      byAccount: Object.fromEntries(codes.map((code) => [code, balance(ls.filter((l) => l.account_code === code), "debit")])),
      balanceCents: balance(ls, "debit"),
    }));
    return c.json({ asOf, accounts: codes.map((code) => ({ code, name: name(code) })), controlCents: balance(lines, "debit"), people: people.filter((p) => p.balanceCents || Object.values(p.byAccount).some(Boolean)).sort((a, b) => a.party.localeCompare(b.party)) });
  }

  if (kind === "loans") {
    // Principal sits in each loan's own Loans Payable account; interest owed sits in 2250
    // Accrued Interest Payable, tagged to its loan ("loan:<id>"). Shown side by side, never mixed.
    const registers = await loadRegisters(serviceClient(c.env));
    const loans = (registers.loans ?? []).filter((l) => l.in_force && (!book || l.book === book));
    const lines = await partyLines(c.env, ["2250", ...new Set(loans.map((l) => l.account_code))], asOf, book);
    const interest = lines.filter((l) => l.account_code === "2250");
    const rows = loans.map((l) => {
      const paid = (l.installments ?? []).filter((i) => i.paid_entry_id);
      return {
        id: l.id,
        name: l.name,
        lender: (l as { lender_name?: string }).lender_name ?? "",
        accountCode: l.account_code,
        principalCents: balance(lines.filter((x) => x.account_code === l.account_code), "credit"),
        trackerCents: toCents(Number(l.principal)) - paid.reduce((s, i) => s + toCents(Number(i.principal)), 0),
        interestPayableCents: balance(interest.filter((x) => x.party_id === `loan:${l.id}`), "credit"),
        approved: !l.entry_id || l.entry_status === "Approved",
      };
    });
    const untagged = interest.filter((x) => !x.party_id?.startsWith("loan:"));
    return c.json({
      asOf,
      loans: rows,
      untaggedInterestCents: balance(untagged, "credit"),
      untaggedEntries: [...new Set(untagged.map((x) => x.entry_id))],
      interestControlCents: balance(interest, "credit"),
    });
  }

  if (kind === "owners") {
    // Owner loans (we owe them) and owner advances (they owe us) are never netted.
    const lines = await partyLines(c.env, ["2260", "1250"], asOf, book);
    const per = (code: string, normal: "debit" | "credit") =>
      [...groupBy(lines.filter((l) => l.account_code === code), partyKey).values()]
        .map((ls) => ({ party: ls[0].party_name ?? "(no owner)", balanceCents: balance(ls, normal) }))
        .filter((p) => p.balanceCents);
    return c.json({ asOf, loans: per("2260", "credit"), advances: per("1250", "debit") });
  }

  if (kind === "reimbursements") {
    const codes = children(accounts, "2110");
    const lines = await partyLines(c.env, codes, asOf, book);
    return c.json({
      asOf,
      people: codes.map((code) => ({ code, name: name(code), balanceCents: balance(lines.filter((l) => l.account_code === code), "credit") })),
    });
  }

  if (kind === "clearing") {
    const lines = await partyLines(c.env, CLEARING_ACCOUNTS, asOf, book);
    return c.json({
      asOf,
      buckets: AGE_BUCKETS.map((b) => b.label),
      accounts: CLEARING_ACCOUNTS.map((code) => {
        const { items, balanceCents } = openItems(lines.filter((l) => l.account_code === code), "debit", asOf);
        const limit = CLEARING_LIMIT_DAYS[code];
        return { code, name: name(code), limitDays: limit, balanceCents, buckets: bucketize(items), overdue: items.filter((i) => i.ageDays > limit), items };
      }),
    });
  }

  badRequest("Unknown sub-ledger.");
});

// Supplier cost comparison for the eight COGS ingredients.
ledger.get("/costs", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (!isDate(from) || !isDate(to)) badRequest("Choose a date range.");
  const accounts = await accountMap(c.env);
  const { data, error } = await serviceClient(c.env).rpc("cost_lines", { p_accounts: INGREDIENT_ACCOUNTS, p_from: from, p_to: to });
  dbError(error);
  return c.json({
    ingredients: INGREDIENT_ACCOUNTS.map((code) => ({ code, name: accounts.get(code)?.name ?? code })),
    lines: data ?? [],
  });
});
