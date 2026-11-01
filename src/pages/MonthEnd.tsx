import { useState } from "react";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import type { Attachment, EntryDraft } from "../../shared/entries";
import { monthEnd } from "../../shared/ledger";
import { formatPeso, toCents } from "../../shared/money";
import { type CountLine, countValue, GENERATED_LABELS, type GeneratedKind } from "../../shared/monthEnd";
import type { AppUser, Book, ProfitCenter } from "../../shared/types";
import { EntryPreview } from "../components/EntryPreview";
import { AttachmentPicker } from "../components/inputs";
import { api } from "../lib/api";
import { todayManila, useAccounts, useLoad } from "../lib/data";
import { useParam } from "./Ledger";

/** The month most likely being worked on at month-end: last month (it closes by the 10th). */
function defaultPeriod(): string {
  const [y, m] = todayManila().split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

export default function MonthEnd({ user }: { user: AppUser }) {
  const [period, setPeriod] = useParam("period", defaultPeriod());
  const books = user.role === "Owner" || user.role === "Accountant";
  const q = `?period=${period}`;
  return (
    <section>
      <div className="page-head">
        <h1>Month-end</h1>
        <input type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
      </div>
      <nav className="tabs">
        {books && (
          <NavLink to={`/month-end${q}`} end>
            Close checklist
          </NavLink>
        )}
        {books && <NavLink to={`/month-end/adjustments${q}`}>Adjusting entries</NavLink>}
        <NavLink to={`/month-end/inventory${q}`}>Inventory count</NavLink>
        {books && <NavLink to={`/month-end/reconciliations${q}`}>Reconciliations</NavLink>}
      </nav>
      <Routes>
        {books && <Route index element={<Checklist period={period} user={user} />} />}
        {books && <Route path="adjustments" element={<Adjustments period={period} />} />}
        <Route path="inventory" element={<Inventory period={period} user={user} />} />
        {books && <Route path="reconciliations" element={<Reconciliations period={period} />} />}
        <Route path="*" element={<Inventory period={period} user={user} />} />
      </Routes>
    </section>
  );
}

interface Check {
  key: string;
  label: string;
  status: "pass" | "fail" | "warn";
  details: string[];
}

function Checklist({ period, user }: { period: string; user: AppUser }) {
  const { data, error, reload } = useLoad<{ status: string; closedAt: string | null; checks: Check[] }>(`/month-end/${period}/checks`);
  const [busy, setBusy] = useState(false);
  const failing = data?.checks.filter((c) => c.status === "fail") ?? [];

  async function act(path: string, body?: object) {
    setBusy(true);
    try {
      await api(`/month-end/${period}/${path}`, { method: "POST", body: JSON.stringify(body ?? {}) });
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not do that");
    }
    setBusy(false);
  }

  return (
    <>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Running the checks…</p>}
      {data && (
        <>
          <p>
            {period} is <span className={`badge ${data.status === "Final" ? "ok" : "info"}`}>{data.status === "Final" ? "Final (closed)" : "Open: statements Preliminary"}</span>
            {data.status !== "Final" && <span className="muted"> · close by the 10th of the following month</span>}
          </p>
          <div className="card">
            {data.checks.map((c) => (
              <div key={c.key} className="check">
                <span className={`badge ${c.status === "pass" ? "ok" : c.status === "warn" ? "warn" : "error"}`}>{c.status === "pass" ? "Pass" : c.status === "warn" ? "Review" : "Fail"}</span>
                <div>
                  <strong>{c.label}</strong>
                  {c.details.length > 0 && (
                    <ul>
                      {c.details.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ))}
          </div>
          {user.role === "Owner" && data.status !== "Final" && (
            <div className="card">
              <p className="muted">
                {failing.length
                  ? `${failing.length} check${failing.length > 1 ? "s" : ""} must pass before closing. Items marked Review don't block the close.`
                  : "Everything passes. Closing marks the month Final and locks it; only an Owner can reopen it, with a reason."}
              </p>
              <button disabled={busy || failing.length > 0} onClick={() => confirm(`Close ${period}? It will be locked.`) && act("close")}>
                Close {period}
              </button>
            </div>
          )}
          {user.role === "Owner" && data.status === "Final" && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                const reason = prompt(`Reopen ${period}? The reason is logged.\n\nReason:`);
                if (reason?.trim()) act("reopen", { reason });
              }}
            >
              Reopen {period}
            </button>
          )}
        </>
      )}
    </>
  );
}

interface AdjRow {
  kind: GeneratedKind;
  book: Book;
  existing: { id: number; status: string } | null;
  proposal: { entry: EntryDraft; details: { label: string; cents: number }[] } | null;
}

function Adjustments({ period }: { period: string }) {
  const { data, error, reload } = useLoad<{ endsOn: string; rows: AdjRow[] }>(`/month-end/${period}/adjustments`);
  const accountList = useAccounts();
  const accounts = new Map(accountList.map((a) => [a.code, a]));
  const [busy, setBusy] = useState<string | null>(null);
  const early = monthEnd(period) > todayManila();

  async function generate(r: AdjRow) {
    setBusy(`${r.kind}${r.book}`);
    try {
      await api(`/month-end/${period}/adjustments`, { method: "POST", body: JSON.stringify({ kind: r.kind, book: r.book }) });
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not generate");
    }
    setBusy(null);
  }

  return (
    <>
      <p className="muted">
        Worked out from the registers and payroll, dated {monthEnd(period)}, and sent to an Owner for approval one by one. Payroll for the 16th to
        month-end is entered with #22 as usual. Inventory adjustments are made from the Inventory count tab.
      </p>
      {error && <p className="error">{error}</p>}
      {data && !data.rows.length && <p className="muted">Nothing to adjust this month (no assets, spreads, loans or payroll yet).</p>}
      {data?.rows.map((r) => (
        <div key={r.kind + r.book} className="card">
          <div className="page-head">
            <h2>
              {GENERATED_LABELS[r.kind]} · {r.book}
            </h2>
            {r.existing ? (
              <span className={`badge ${r.existing.status === "Approved" ? "ok" : "info"}`}>
                <Link to={`/journal?entry=${r.existing.id}`}>Entry #{r.existing.id}</Link> {r.existing.status}
              </span>
            ) : (
              <button disabled={early || busy === `${r.kind}${r.book}`} onClick={() => generate(r)}>
                {early ? `Available from ${monthEnd(period)}` : "Generate entry"}
              </button>
            )}
          </div>
          {r.proposal && !r.existing && (
            <>
              <table className="lines">
                <tbody>
                  {r.proposal.details.map((d) => (
                    <tr key={d.label}>
                      <td>{d.label}</td>
                      <td className="num">{formatPeso(d.cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <EntryPreview entries={[r.proposal.entry]} accounts={accounts} />
            </>
          )}
        </div>
      ))}
    </>
  );
}

interface CountRow {
  lines: CountLine[];
  notes: string | null;
  entry_id: number | null;
  period_key: string;
}
interface Location {
  book: Book;
  pc: ProfitCenter;
  count: CountRow | null;
  previous: CountRow | null;
  ledgerCents: number | null;
}

function Inventory({ period, user }: { period: string; user: AppUser }) {
  const { data, error, reload } = useLoad<{ locations: Location[] }>(`/month-end/${period}/inventory`);
  return (
    <>
      <p className="muted">
        Optional. Count what's on hand at month-end, per location. Raw ingredients at the latest purchase price; items made in-house at the transfer
        price. If a month isn't counted, the last count carries forward.
      </p>
      {error && <p className="error">{error}</p>}
      {data?.locations.map((l) => <CountForm key={`${period}${l.book}${l.pc}`} period={period} location={l} user={user} onSaved={reload} />)}
    </>
  );
}

const emptyCountLine = (): CountLine => ({ item: "", unit: "", quantity: "", unit_value: "", account: "" });

function CountForm({ period, location, user, onSaved }: { period: string; location: Location; user: AppUser; onSaved: () => void }) {
  const accountList = useAccounts();
  const ingredients = accountList.filter((a) => /^51\d\d$/.test(a.code) && !a.isHeader && a.code !== "5199");
  const start = location.count?.lines ?? location.previous?.lines.map((l) => ({ ...l, quantity: "" })) ?? [];
  const [lines, setLines] = useState<CountLine[]>(start.length ? start : [emptyCountLine()]);
  const [notes, setNotes] = useState(location.count?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const locked = !!location.count?.entry_id;
  const total = lines.reduce((s, l) => s + (l.item ? countValue(l) : 0), 0);
  const previousTotal = location.previous?.lines.reduce((s, l) => s + countValue(l), 0) ?? null;
  const set = (i: number, patch: Partial<CountLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const books = user.role === "Owner" || user.role === "Accountant";

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await api(`/month-end/${period}/inventory`, { method: "PUT", body: JSON.stringify({ book: location.book, profitCenter: location.pc, lines, notes }) });
      setMessage("Saved.");
      onSaved();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save");
    }
    setBusy(false);
  }
  async function generate() {
    setBusy(true);
    try {
      await api(`/month-end/${period}/inventory/generate`, { method: "POST", body: JSON.stringify({ book: location.book, profitCenter: location.pc }) });
      onSaved();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not generate");
    }
    setBusy(false);
  }

  return (
    <div className="card">
      <div className="page-head">
        <h2>
          {location.book === "Commissary" ? "Commissary" : `Store – ${location.pc}`}
        </h2>
        {!location.count && <span className="badge warn">Not counted</span>}
        {locked && (
          <span className="badge ok">
            Adjusted in <Link to={`/journal?entry=${location.count!.entry_id}`}>entry #{location.count!.entry_id}</Link>
          </span>
        )}
      </div>
      <div className="table-wrap">
        <table className="rows-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Ingredient</th>
              <th>Unit</th>
              <th>Quantity</th>
              <th>Unit value</th>
              <th className="num">Value</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <input value={l.item} disabled={locked} onChange={(e) => set(i, { item: e.target.value })} />
                </td>
                <td>
                  <select value={l.account} disabled={locked} onChange={(e) => set(i, { account: e.target.value })}>
                    <option value="">Choose…</option>
                    {ingredients.map((a) => (
                      <option key={a.code} value={a.code}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input value={l.unit} disabled={locked} onChange={(e) => set(i, { unit: e.target.value })} size={5} />
                </td>
                <td>
                  <input type="number" step="0.001" min="0" disabled={locked} value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} />
                </td>
                <td>
                  <input type="number" step="0.01" min="0" disabled={locked} value={l.unit_value} onChange={(e) => set(i, { unit_value: e.target.value })} />
                </td>
                <td className="num">{l.item ? formatPeso(countValue(l)) : ""}</td>
                <td>
                  {!locked && lines.length > 1 && (
                    <button className="link danger" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>
                {!locked && (
                  <button className="link" onClick={() => setLines([...lines, emptyCountLine()])}>
                    + Add item
                  </button>
                )}
              </td>
              <td className="num">{formatPeso(total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="muted">
        {previousTotal !== null ? `Last count (${location.previous!.period_key}): ${formatPeso(previousTotal)}` : "No earlier count."}
        {location.ledgerCents !== null && ` · Inventory in the ledger: ${formatPeso(location.ledgerCents)}`}
      </p>
      <label>
        Notes
        <input value={notes} disabled={locked} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {message && <p className={message === "Saved." ? "muted" : "error"}>{message}</p>}
      {!locked && (
        <div className="row-actions">
          <button className="secondary" disabled={busy} onClick={save}>
            Save count
          </button>
          {books && location.count && (
            <button disabled={busy || monthEnd(period) > todayManila()} onClick={generate}>
              Generate adjustment
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface RecRow {
  code: string;
  name: string;
  book: Book;
  cashOnHand: boolean;
  ledgerCents: number;
  rec: { statement_balance: number; items: { description: string; amount: number }[]; attachments: Attachment[] } | null;
  differenceCents: number | null;
}

function Reconciliations({ period }: { period: string }) {
  const { data, error, reload } = useLoad<{ asOf: string; rows: RecRow[] }>(`/month-end/${period}/reconciliations`);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <p className="muted">
        Each bank and e-wallet against its statement, and each cash-on-hand account against the actual count, as of {data?.asOf ?? monthEnd(period)}.
        Reconciling items (deposits in transit, bank charges not yet recorded…) bring the statement to the ledger.
      </p>
      {error && <p className="error">{error}</p>}
      {data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th className="num">Ledger</th>
                <th className="num">Statement / count</th>
                <th className="num">Difference</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const key = `${r.code}|${r.book}`;
                return [
                  <tr key={key}>
                    <td>
                      {r.code} {r.name}
                      {r.book === "Commissary" && <span className="muted"> · Commissary</span>}
                    </td>
                    <td className="num">{formatPeso(r.ledgerCents)}</td>
                    <td className="num">{r.rec ? formatPeso(toCents(Number(r.rec.statement_balance))) : ""}</td>
                    <td className="num">
                      {r.differenceCents === null ? (
                        <span className="badge warn">Not done</span>
                      ) : r.differenceCents === 0 ? (
                        <span className="badge ok">Reconciled</span>
                      ) : (
                        <span className="badge error">{formatPeso(r.differenceCents)}</span>
                      )}
                    </td>
                    <td>
                      <button className="link" onClick={() => setOpen(open === key ? null : key)}>
                        {open === key ? "Close" : r.rec ? "Edit" : "Reconcile"}
                      </button>
                    </td>
                  </tr>,
                  open === key && (
                    <tr key={`${key}-form`}>
                      <td colSpan={5}>
                        <RecForm
                          period={period}
                          row={r}
                          onSaved={() => {
                            setOpen(null);
                            reload();
                          }}
                        />
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function RecForm({ period, row, onSaved }: { period: string; row: RecRow; onSaved: () => void }) {
  const [statement, setStatement] = useState(row.rec ? String(row.rec.statement_balance) : "");
  const [items, setItems] = useState<{ description: string; amount: number | string }[]>(row.rec?.items ?? []);
  const [attachments, setAttachments] = useState<Attachment[]>(row.rec?.attachments ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reconciled = toCents(Number(statement) || 0) + items.reduce((s, i) => s + toCents(Number(i.amount) || 0), 0);
  const diff = reconciled - row.ledgerCents;
  const set = (i: number, patch: Partial<{ description: string; amount: number | string }>) => setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/month-end/${period}/reconciliations`, {
        method: "PUT",
        body: JSON.stringify({ account: row.code, book: row.book, statementBalance: Number(statement), items, attachments }),
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
    }
    setBusy(false);
  }

  return (
    <div className="row-card">
      <label>
        {row.cashOnHand ? "Actual cash counted" : "Statement ending balance"}
        <input type="number" step="0.01" value={statement} onChange={(e) => setStatement(e.target.value)} />
      </label>
      <h3>Reconciling items</h3>
      {items.map((it, i) => (
        <div key={i} className="grid3">
          <input placeholder="e.g. Deposit in transit Nov 30" value={it.description} onChange={(e) => set(i, { description: e.target.value })} />
          <input type="number" step="0.01" placeholder="+ adds to statement, − subtracts" value={it.amount} onChange={(e) => set(i, { amount: e.target.value })} />
          <button className="link danger" onClick={() => setItems(items.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <button className="link" onClick={() => setItems([...items, { description: "", amount: "" }])}>
        + Add reconciling item
      </button>
      <p>
        Statement + items {formatPeso(reconciled)} · Ledger {formatPeso(row.ledgerCents)} ·{" "}
        <span className={diff === 0 ? "badge ok" : "badge error"}>{diff === 0 ? "Reconciled" : `Difference ${formatPeso(diff)}`}</span>
      </p>
      <p className="muted">
        {row.cashOnHand
          ? "A difference in a cash count is a shortage or overage; record it (e.g. #28 or a special entry) and reconcile again."
          : "Bank charges or interest on the statement but not in the books need an entry; items in the books but not yet on the statement are reconciling items."}
      </p>
      <AttachmentPicker value={attachments} onChange={setAttachments} multiple label={row.cashOnHand ? "Attach count sheet" : "Attach statement"} />
      {err && <p className="error">{err}</p>}
      <button disabled={busy || statement === ""} onClick={save}>
        Save reconciliation
      </button>
    </div>
  );
}
