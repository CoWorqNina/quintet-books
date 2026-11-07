import { Hono } from "hono";
import { allocate, summarize } from "../../shared/cash";
import { CLEARING_LIMIT_DAYS, groupBy, openItems, type PartyLine } from "../../shared/ledger";
import { toCents } from "../../shared/money";
import type { Account } from "../../shared/types";
import { todayManila, viewsBooks } from "../access";
import { getAccounts } from "../airtable";
import { badRequest, dbError, forbidden } from "../db";
import type { AppContext } from "../env";
import { serviceClient } from "../supabase";

export const cash = new Hono<AppContext>();

const isDate = (d: string | undefined): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);

/** Receivable groups, in the order shown. */
const RECEIVABLE_GROUPS: { key: string; label: string; match: (a: Account) => boolean }[] = [
  { key: "sales", label: "Sales due for transfer (card, Grab, Foodpanda)", match: (a) => a.parentCode === "1180" },
  { key: "transit", label: "In transit & to classify", match: (a) => a.code === "1190" || a.code === "1195" },
  { key: "employees", label: "Employees", match: (a) => a.parentCode === "1240" },
  { key: "owners", label: "Owners", match: (a) => a.code === "1250" || a.code === "1255" },
  { key: "related", label: "CLD and related parties", match: (a) => a.code === "1220" || a.code === "1230" },
  { key: "suppliers", label: "Advances to suppliers", match: (a) => a.code === "1260" },
  { key: "tax", label: "Creditable withholding tax", match: (a) => a.code === "1270" },
  { key: "books", label: "Between books (Commissary ↔ Store)", match: (a) => a.code === "1280" },
  { key: "deposits", label: "Refundable deposits", match: (a) => a.parentCode === "1400" && a.code !== "1430" },
];

function range(c: { req: { query: (k: string) => string | undefined } }) {
  const today = todayManila();
  const from = c.req.query("from") ?? `${today.slice(0, 7)}-01`;
  const to = c.req.query("to") ?? today;
  if (!isDate(from) || !isDate(to) || from > to) badRequest("Choose a date range.");
  return { from, to };
}

type CashLine = { entry_id: number; entry_date: string; book: string; account_code: string; debit: number; credit: number };

// Cash per account for a date range (opening, in, out, closing, where it came from and went),
// and receivables per account and party at the end of the range.
cash.get("/", async (c) => {
  if (!viewsBooks(c.get("user"))) forbidden();
  const { from, to } = range(c);
  const db = serviceClient(c.env);
  const accounts = new Map((await getAccounts(c.env)).map((a) => [a.code, a]));
  const name = (code: string) => (code ? (accounts.get(code)?.name ?? code) : "(unbalanced)");
  const cashList = [...accounts.values()].filter((a) => a.isCashAccount && !a.isHeader && a.active).sort((a, b) => a.code.localeCompare(b.code));
  const cashCodes = cashList.map((a) => a.code);
  const recList = [...accounts.values()].filter((a) => !a.isHeader && RECEIVABLE_GROUPS.some((g) => g.match(a)));

  const [openings, moves, recLines] = await Promise.all([
    Promise.all(cashCodes.map((code) => db.rpc("gl_opening", { p_account: code, p_book: null, p_before: from, p_since: null }))),
    db.rpc("cash_entry_lines", { p_from: from, p_to: to, p_cash: cashCodes }),
    db.rpc("party_lines", { p_accounts: recList.map((a) => a.code), p_to: to }),
  ]);
  for (const o of openings) dbError(o.error);
  dbError(moves.error);
  dbError(recLines.error);
  const lines = (moves.data ?? []) as CashLine[];
  const allocs = allocate(lines, (code) => cashCodes.includes(code));
  const named = (list: { against: string; cents: number }[]) => list.map((x) => ({ ...x, name: name(x.against), isCash: cashCodes.includes(x.against) }));

  const cashRows = cashList.map((a, i) => {
    const own = lines.filter((l) => l.account_code === a.code);
    const inCents = own.reduce((s, l) => s + toCents(Number(l.debit)), 0);
    const outCents = own.reduce((s, l) => s + toCents(Number(l.credit)), 0);
    const openingCents = toCents(Number(openings[i].data ?? 0));
    const { inflows, outflows } = summarize(allocs.filter((x) => x.account === a.code));
    return { code: a.code, name: a.name, book: a.book, openingCents, inCents, outCents, closingCents: openingCents + inCents - outCents, inflows: named(inflows), outflows: named(outflows) };
  });

  const rl = (recLines.data ?? []) as PartyLine[];
  const receivables = RECEIVABLE_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    accounts: recList
      .filter(g.match)
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((a) => {
        const ls = rl.filter((l) => l.account_code === a.code);
        const parties = [...groupBy(ls, (l) => l.party_id ?? l.party_name ?? "").values()]
          .map((pl) => {
            const { items, balanceCents } = openItems(pl, "debit", to);
            return { party: pl[0].party_name ?? "", balanceCents, oldestDays: items.length ? Math.max(...items.map((x) => x.ageDays)) : 0, items: items.length };
          })
          .filter((p) => p.balanceCents)
          .sort((x, y) => y.balanceCents - x.balanceCents);
        const balanceCents = ls.reduce((s, l) => s + toCents(Number(l.debit)) - toCents(Number(l.credit)), 0);
        return { code: a.code, name: a.name, book: a.book, balanceCents, limitDays: CLEARING_LIMIT_DAYS[a.code] ?? null, parties };
      })
      .filter((a) => a.balanceCents || a.parties.length),
  })).filter((g) => g.accounts.length);

  return c.json({ from, to, cash: cashRows, receivables });
});

// Every movement of one account in the range, with what it was against and a running balance.
cash.get("/movements", async (c) => {
  if (!viewsBooks(c.get("user"))) forbidden();
  const { from, to } = range(c);
  const code = c.req.query("account") ?? "";
  const accounts = new Map((await getAccounts(c.env)).map((a) => [a.code, a]));
  const account = accounts.get(code);
  if (!account || account.isHeader) badRequest("Choose an account.");
  const db = serviceClient(c.env);
  const [opening, gl, all] = await Promise.all([
    db.rpc("gl_opening", { p_account: code, p_book: null, p_before: from, p_since: null }),
    db.rpc("gl_lines", { p_account: code, p_book: null, p_from: from, p_to: to }),
    db.rpc("cash_entry_lines", { p_from: from, p_to: to, p_cash: [code] }),
  ]);
  dbError(opening.error);
  dbError(gl.error);
  dbError(all.error);
  const allocs = allocate((all.data ?? []) as CashLine[], (x) => x === code);
  const againstBy = groupBy(allocs, (a) => String(a.entryId));
  type GL = { entry_id: number; entry_date: string; transaction_type: number | null; kind: string; book: string; description: string | null; source_document: string | null; party_name: string | null; memo: string | null; debit: number; credit: number };
  let running = toCents(Number(opening.data ?? 0));
  const openingCents = running;
  const seen = new Set<number>();
  const out = ((gl.data ?? []) as GL[]).map((l) => {
    const inCents = toCents(Number(l.debit));
    const outCents = toCents(Number(l.credit));
    running += inCents - outCents;
    // List counter-accounts once per entry (an entry can hit the account on several lines).
    const first = !seen.has(l.entry_id);
    seen.add(l.entry_id);
    const against = first ? [...new Set((againstBy.get(String(l.entry_id)) ?? []).map((a) => a.against))].map((x) => ({ code: x, name: accounts.get(x)?.name ?? x })) : [];
    return {
      entryId: l.entry_id,
      date: l.entry_date,
      kind: l.kind,
      transactionType: l.transaction_type,
      book: l.book,
      description: l.description,
      reference: l.source_document,
      party: l.party_name,
      memo: l.memo,
      inCents,
      outCents,
      balanceCents: running,
      against,
    };
  });
  return c.json({ account: { code, name: account.name }, from, to, openingCents, lines: out, inCents: out.reduce((s, l) => s + l.inCents, 0), outCents: out.reduce((s, l) => s + l.outCents, 0), closingCents: running });
});
