import { useMemo, useState } from "react";
import { ACCOUNTS } from "../../shared/accounts";
import { buildClassification, type ClassifyLine } from "../../shared/manual";
import { toCents } from "../../shared/money";
import type { Account, AppUser, JournalEntry } from "../../shared/types";
import { EntryCard } from "../components/EntryCard";
import { EntryPreview } from "../components/EntryPreview";
import { api } from "../lib/api";
import { todayManila, useAccounts, useLoad } from "../lib/data";

/** "For Classification" queue: unexplained cash movements (#39) waiting for an Owner to classify. */
export default function Classify({ user }: { user: AppUser }) {
  const { data, error, reload } = useLoad<JournalEntry[]>("/entries/unclassified");
  const accountList = useAccounts();
  const accounts = useMemo(() => new Map(accountList.map((a) => [a.code, a])), [accountList]);
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section>
      <h1>For classification</h1>
      <p className="muted">
        Cash that moved without a clear purpose sits in {ACCOUNTS.suspense} until an Owner says what it was. Each classification is approved by
        the other Owner and noted in the Judgment Log.
      </p>
      {error && <p className="error">{error}</p>}
      {data && !data.length && <p className="muted">Nothing waiting.</p>}
      {data?.map((e) => (
        <div key={e.id}>
          <EntryCard
            entry={e}
            actions={
              user.role === "Owner" && (
                <button className="link" onClick={() => setOpen(open === e.id ? null : e.id)}>
                  {open === e.id ? "Close" : "Classify"}
                </button>
              )
            }
          />
          {open === e.id && (
            <ClassifyForm
              entry={e}
              accounts={accounts}
              accountList={accountList}
              onDone={() => {
                setOpen(null);
                reload();
              }}
            />
          )}
        </div>
      ))}
    </section>
  );
}

function ClassifyForm({ entry, accounts, accountList, onDone }: { entry: JournalEntry; accounts: Map<string, Account>; accountList: Account[]; onDone: () => void }) {
  const suspense = entry.lines.find((l) => l.accountCode === ACCOUNTS.suspense);
  const moneyOut = !!suspense?.debit;
  const amount = suspense ? suspense.debit || suspense.credit : 0;
  const [lines, setLines] = useState<ClassifyLine[]>([{ account: "", amount, profitCenter: "" }]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const usable = accountList.filter((a) => !a.isHeader && a.active && a.code !== ACCOUNTS.suspense && (a.book === "Both" || a.book === entry.book));
  const built = buildClassification(
    { id: entry.id, book: entry.book, date: entry.entryDate, amountCents: toCents(amount), moneyOut, description: entry.description ?? "" },
    { date: todayManila(), reason, lines },
    accounts,
  );
  const set = (i: number, patch: Partial<ClassifyLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function submit() {
    setBusy(true);
    setServerError(null);
    try {
      await api(`/entries/${entry.id}/classify`, { method: "POST", body: JSON.stringify({ reason, lines }) });
      onDone();
    } catch (e) {
      setServerError(e instanceof Error ? e.message : "Could not save");
    }
    setBusy(false);
  }

  return (
    <div className="card">
      <p>
        {moneyOut ? "Money out" : "Money in"} of {amount.toFixed(2)}. What was it?
      </p>
      {lines.map((l, i) => {
        const a = accounts.get(l.account);
        const needsPc = a?.statement === "Income Statement" && entry.book === "Store" && !["GGC", "The Nest", "Shared"].includes(a.profitCenterRule ?? "");
        return (
          <div key={i} className="grid2">
            <label>
              Account
              <select value={l.account} onChange={(e) => set(i, { account: e.target.value })}>
                <option value="">Choose…</option>
                {usable.map((x) => (
                  <option key={x.code} value={x.code}>
                    {x.code} {x.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount
              <input type="number" step="0.01" value={l.amount} onChange={(e) => set(i, { amount: e.target.value })} />
            </label>
            {needsPc && (
              <label>
                Profit center
                <select value={l.profitCenter ?? ""} onChange={(e) => set(i, { profitCenter: e.target.value })}>
                  <option value="">Choose…</option>
                  <option>GGC</option>
                  <option>The Nest</option>
                  {!a?.profitCenterRule?.startsWith("GGC or The Nest") && <option>Shared</option>}
                </select>
              </label>
            )}
          </div>
        );
      })}
      <button className="link" onClick={() => setLines([...lines, { account: "", amount: "", profitCenter: "" }])}>
        + Split into another account
      </button>
      <label>
        What it turned out to be
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Ana's cash advance, confirmed with her" />
      </label>
      {lines.some((l) => l.account) && built.errors.length > 0 && (
        <ul className="errors">
          {built.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {built.entry && <EntryPreview entries={[built.entry]} accounts={accounts} />}
      {serverError && <p className="error">{serverError}</p>}
      <button disabled={busy || !built.entry} onClick={submit}>
        {busy ? "Submitting…" : "Submit classification"}
      </button>
    </div>
  );
}
