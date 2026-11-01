// Pieces of the monthly management report that are pure calculation: the brand income
// statement (Store and Commissary shown within GGC) and the key ratios.

import { incomeStatement, pcOf, type StatementRow, type StatementTotal } from "./statements";
import type { Account } from "./types";

export const BRAND_COLUMNS = ["Store", "Commissary", "Eliminations", "GGC", "The Nest", "Shared", "Total"];

/**
 * GGC's Store and Commissary books side by side, the Commissary billings removed in an
 * Eliminations column, then GGC, The Nest, Shared and the total. Store + Commissary +
 * Eliminations = GGC; GGC + The Nest + Shared = Total.
 */
export function brandIncomeStatement(totals: StatementTotal[], accounts: Map<string, Account>): StatementRow[] {
  const ELIM = "~eliminations";
  const rows: StatementTotal[] = [];
  for (const t of totals) {
    rows.push(t);
    if (t.intercompany && pcOf(t) === "GGC") rows.push({ ...t, debit: t.credit, credit: t.debit, period_key: ELIM });
  }
  return incomeStatement(rows, accounts, "all", BRAND_COLUMNS, (t) => {
    if (t.period_key === ELIM) return ["Eliminations"];
    const pc = pcOf(t);
    const cols: string[] = [];
    if (pc === "GGC") cols.push(t.book);
    if (!t.intercompany) cols.push(pc, "Total");
    return cols;
  });
}

/** Sum of income statement lines whose accounts all match, as a positive cost (centavos). */
export function costOf(rows: StatementRow[], col: string, match: (code: string) => boolean): number {
  return -rows.filter((r) => r.kind === "line" && r.codes?.length && r.codes.every(match)).reduce((s, r) => s + (r.values[col] ?? 0), 0);
}

export interface Ratios {
  netSalesCents: number;
  cogsPct: number;
  laborPct: number;
  utilitiesPct: number;
  marketingPct: number;
  netMarginPct: number;
}

/** Key ratios (basis points of net sales) for one column of a whole-business income statement. */
export function ratios(rows: StatementRow[], col: string): Ratios {
  const ns = rows.find((r) => r.label === "Net Sales")!.values[col] ?? 0;
  const bp = (cents: number) => (ns ? Math.round((cents / ns) * 10000) : 0);
  return {
    netSalesCents: ns,
    cogsPct: bp(-(rows.find((r) => r.label === "Total Cost of Goods Sold")!.values[col] ?? 0)),
    laborPct: bp(costOf(rows, col, (c) => c.startsWith("61"))),
    utilitiesPct: bp(costOf(rows, col, (c) => c.startsWith("63"))),
    marketingPct: bp(costOf(rows, col, (c) => c >= "6510" && c <= "6549")),
    netMarginPct: bp(rows.find((r) => r.label === "NET INCOME BEFORE TAX")!.values[col] ?? 0),
  };
}
