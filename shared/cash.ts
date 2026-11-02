// Where money came from and went to: each focus-account line of an entry is matched to the
// entry's lines on the other side, shared out in proportion to their amounts.

import { toCents } from "./money";

export interface EntryLine {
  entry_id: number;
  account_code: string;
  debit: number | string;
  credit: number | string;
}

export interface Allocation {
  entryId: number;
  /** The focus account (e.g. the bank). */
  account: string;
  /** The account on the other side (e.g. sales, a supplier payable, another bank). */
  against: string;
  /** Positive = money into the focus account, negative = out. */
  cents: number;
}

const c = (v: number | string) => toCents(Number(v));

export function allocate(lines: EntryLine[], focus: (code: string) => boolean): Allocation[] {
  const byEntry = new Map<number, EntryLine[]>();
  for (const l of lines) byEntry.set(l.entry_id, [...(byEntry.get(l.entry_id) ?? []), l]);
  const out: Allocation[] = [];
  for (const [entryId, ls] of byEntry) {
    for (const f of ls.filter((l) => focus(l.account_code))) {
      const amount = c(f.debit) - c(f.credit);
      if (!amount) continue;
      // The other side: credits when money came in, debits when it went out.
      const others = ls.filter((l) => l !== f && (amount > 0 ? c(l.credit) > 0 : c(l.debit) > 0));
      const weights = others.map((l) => (amount > 0 ? c(l.credit) : c(l.debit)));
      const total = weights.reduce((s, w) => s + w, 0);
      if (!total) {
        out.push({ entryId, account: f.account_code, against: "", cents: amount });
        continue;
      }
      let left = amount;
      others.forEach((l, i) => {
        const share = i === others.length - 1 ? left : Math.round((amount * weights[i]) / total);
        left -= share;
        out.push({ entryId, account: f.account_code, against: l.account_code, cents: share });
      });
    }
  }
  return out;
}

/** Totals per counter-account, money in and money out kept apart, biggest first. */
export function summarize(allocs: Allocation[]): { inflows: { against: string; cents: number }[]; outflows: { against: string; cents: number }[] } {
  const ins = new Map<string, number>();
  const outs = new Map<string, number>();
  for (const a of allocs) {
    const m = a.cents > 0 ? ins : outs;
    m.set(a.against, (m.get(a.against) ?? 0) + Math.abs(a.cents));
  }
  const list = (m: Map<string, number>) => [...m].map(([against, cents]) => ({ against, cents })).sort((x, y) => y.cents - x.cents);
  return { inflows: list(ins), outflows: list(outs) };
}
