import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GO_LIVE_DATE } from "../../shared/config";
import type { Attachment } from "../../shared/entries";
import { buildManualEntry, type ManualInput, type ManualLine, OPENING_DATE } from "../../shared/manual";
import type { AppUser, Book } from "../../shared/types";
import { EntryPreview } from "../components/EntryPreview";
import { AttachmentPicker } from "../components/inputs";
import { api } from "../lib/api";
import { todayManila, useAccounts, useParties } from "../lib/data";

const emptyLine = (): ManualLine => ({ account: "", debit: "", credit: "", profitCenter: "", party: "", memo: "" });

/** Special and Adjusting entries (Owner/Accountant) and the opening balances (#43, Owner). */
export default function ManualEntry({ user, opening = false }: { user: AppUser; opening?: boolean }) {
  const navigate = useNavigate();
  const accountList = useAccounts();
  const parties = useParties();
  const [kind, setKind] = useState<ManualInput["kind"]>(opening ? "Opening" : "Special");
  const [book, setBook] = useState<Book>(user.books[0] ?? "Store");
  const [date, setDate] = useState(opening ? OPENING_DATE : todayManila());
  const [description, setDescription] = useState(opening ? "Opening balances as of October 31, 2026" : "");
  const [reason, setReason] = useState(opening ? "Balances carried over from the manual books at go-live" : "");
  const [lines, setLines] = useState<ManualLine[]>([emptyLine(), emptyLine()]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const accounts = useMemo(() => new Map(accountList.map((a) => [a.code, a])), [accountList]);
  const usable = accountList.filter(
    (a) => !a.isHeader && a.active && (a.book === "Both" || a.book === book) && (!opening || a.statement === "Balance Sheet"),
  );
  const input: ManualInput = { kind, book, date, description, reason, lines, attachments };
  const built = accountList.length ? buildManualEntry(input, accounts, new Map(parties.map((p) => [p.id, p]))) : null;
  const touched = lines.some((l) => l.account);

  const set = (i: number, patch: Partial<ManualLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const totals = lines.reduce((t, l) => ({ dr: t.dr + (Number(l.debit) || 0), cr: t.cr + (Number(l.credit) || 0) }), { dr: 0, cr: 0 });

  async function submit() {
    setBusy(true);
    setServerError(null);
    try {
      await api(opening ? "/entries/opening" : "/entries/manual", { method: "POST", body: JSON.stringify(input) });
      navigate("/journal?status=Submitted&period=" + date.slice(0, 7));
    } catch (e) {
      setServerError(e instanceof Error ? e.message : "Could not save");
    }
    setBusy(false);
  }

  return (
    <section className="form-page">
      <h1>{opening ? "Opening balances (#43)" : "Special / adjusting entry"}</h1>
      <p className="muted">
        {opening
          ? "Balance sheet accounts as of October 31, 2026, one entry per book. Assets, prepaids and loans that exist at go-live also go in Registers so their schedules continue."
          : "For what no template covers. Every entry needs a reason and is approved one by one by an Owner."}
      </p>
      <div className="card grid2">
        {!opening && (
          <label>
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value as ManualInput["kind"])}>
              <option value="Special">Special (one-off transaction)</option>
              <option value="Adjusting">Adjusting (month-end adjustment)</option>
            </select>
          </label>
        )}
        <label>
          Book
          <select value={book} onChange={(e) => setBook(e.target.value as Book)}>
            {user.books.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input type="date" value={date} min={GO_LIVE_DATE} max={todayManila()} disabled={opening} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="span2">
          Description
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="span2">
          Reason
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this entry is needed" />
        </label>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="rows-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Debit</th>
                <th>Credit</th>
                <th>Profit center</th>
                <th>Party</th>
                <th>Memo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const a = accounts.get(l.account);
                const needsPc = a?.statement === "Income Statement" && book === "Store" && !["GGC", "The Nest", "Shared"].includes(a.profitCenterRule ?? "");
                return (
                  <tr key={i}>
                    <td>
                      <select value={l.account} onChange={(e) => set(i, { account: e.target.value })}>
                        <option value="">Choose…</option>
                        {usable.map((x) => (
                          <option key={x.code} value={x.code}>
                            {x.code} {x.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input type="number" step="0.01" min="0" value={l.debit ?? ""} onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} />
                    </td>
                    <td>
                      <input type="number" step="0.01" min="0" value={l.credit ?? ""} onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} />
                    </td>
                    <td>
                      {needsPc ? (
                        <select value={l.profitCenter ?? ""} onChange={(e) => set(i, { profitCenter: e.target.value })}>
                          <option value="">Choose…</option>
                          <option>GGC</option>
                          <option>The Nest</option>
                          {!a?.profitCenterRule?.startsWith("GGC or The Nest") && <option>Shared</option>}
                        </select>
                      ) : (
                        <span className="muted">{a?.statement === "Income Statement" ? (book === "Commissary" ? "GGC" : a.profitCenterRule) : ""}</span>
                      )}
                    </td>
                    <td>
                      <select value={l.party ?? ""} onChange={(e) => set(i, { party: e.target.value })}>
                        <option value="" />
                        {parties.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.type})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input value={l.memo ?? ""} onChange={(e) => set(i, { memo: e.target.value })} />
                    </td>
                    <td>
                      {lines.length > 2 && (
                        <button className="link danger" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>
                  <button className="link" onClick={() => setLines([...lines, emptyLine()])}>
                    + Add line
                  </button>
                </td>
                <td className="num">{totals.dr.toFixed(2)}</td>
                <td className="num">{totals.cr.toFixed(2)}</td>
                <td colSpan={4} className={Math.abs(totals.dr - totals.cr) > 0.004 ? "error" : "muted"}>
                  Difference {(totals.dr - totals.cr).toFixed(2)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <AttachmentPicker value={attachments} onChange={setAttachments} multiple label="Attach support" />
      </div>

      <div className="card">
        <h2>Entry preview</h2>
        {touched && built?.errors.length ? (
          <ul className="errors">
            {built.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}
        {built?.entry && <EntryPreview entries={[built.entry]} accounts={accounts} />}
        {serverError && <p className="error">{serverError}</p>}
        <button disabled={busy || !built?.entry} onClick={submit}>
          {busy ? "Submitting…" : "Submit for approval"}
        </button>
      </div>
    </section>
  );
}
