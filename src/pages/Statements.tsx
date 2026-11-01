import { Fragment } from "react";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import { formatPeso } from "../../shared/money";
import type { StatementRow } from "../../shared/statements";
import { todayManila, useLoad } from "../lib/data";
import { useParam } from "./Ledger";

interface Column {
  key: string;
  label: string;
  kind?: "pct" | "change";
}
interface Statement {
  title: string;
  subtitle: string;
  scopeLabel?: string;
  view?: string;
  status: "Final" | "Preliminary";
  columns: Column[];
  rows: StatementRow[];
  balanced?: boolean;
  ties?: boolean;
}

const lastMonth = () => {
  const [y, m] = todayManila().split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
};

/** Income Statement, Balance Sheet and Cash Flow, with CSV export and print. */
export default function Statements() {
  const [period, setPeriod] = useParam("period", lastMonth());
  const q = `?period=${period}`;
  return (
    <section className="statements">
      <div className="page-head no-print">
        <h1>Statements</h1>
        <input type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
      </div>
      <nav className="tabs no-print">
        <NavLink to={`/statements${q}`} end>
          Income statement
        </NavLink>
        <NavLink to={`/statements/balance${q}`}>Balance sheet</NavLink>
        <NavLink to={`/statements/cash-flow${q}`}>Cash flow</NavLink>
        <NavLink to={`/statements/cash-accounts${q}`}>Cash per account</NavLink>
      </nav>
      <Routes>
        <Route index element={<Income period={period} />} />
        <Route path="balance" element={<Balance period={period} />} />
        <Route path="cash-flow" element={<CashFlow period={period} />} />
        <Route path="cash-accounts" element={<CashAccounts period={period} />} />
      </Routes>
    </section>
  );
}

function Income({ period }: { period: string }) {
  const [layout, setLayout] = useParam("layout", "month");
  const [scope, setScope] = useParam("scope", "business");
  const { data, error } = useLoad<Statement>(`/statements/income?period=${period}&layout=${layout}&scope=${scope}`);
  return (
    <>
      <div className="page-head no-print">
        <select value={layout} onChange={(e) => setLayout(e.target.value)}>
          <option value="month">Monthly</option>
          <option value="ytd">Year to date</option>
          <option value="monthly">Month by month</option>
          <option value="compare">This month vs year to date</option>
        </select>
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="business">Whole business{layout === "month" || layout === "ytd" ? " (GGC | The Nest | Shared)" : ""}</option>
          <option value="ggc">GGC as a whole</option>
          <option value="store">Store book</option>
          <option value="commissary">Commissary book</option>
          <option value="nest">The Nest</option>
        </select>
        <Exports data={data} name={`income-statement-${layout}-${scope}-${period}`} />
      </div>
      {error && <p className="error">{error}</p>}
      {data && <StatementView data={data} note={data.scopeLabel} />}
      <ul className="notes muted no-print">
        <li>The whole business and GGC as a whole leave out the Commissary's billings to the Store (and the Store's matching cost), so nothing is counted twice.</li>
        <li>Shared depreciation and amortization appear only in the whole-business total, not in the GGC or The Nest exports.</li>
      </ul>
    </>
  );
}

function Balance({ period }: { period: string }) {
  const [view, setView] = useParam("view", "Combined");
  const { data, error } = useLoad<Statement>(`/statements/balance?period=${period}&view=${view}`);
  return (
    <>
      <div className="page-head no-print">
        <ViewSelect value={view} onChange={setView} />
        <Exports data={data} name={`balance-sheet-${view}-${period}`} />
      </div>
      {error && <p className="error">{error}</p>}
      {data && <StatementView data={data} note={view === "Combined" ? "Whole business" : `${view} book`} check={data.balanced === undefined ? undefined : { ok: data.balanced, ok_label: "Assets equal liabilities plus equity", bad_label: "Does not balance" }} />}
    </>
  );
}

function CashFlow({ period }: { period: string }) {
  const [view, setView] = useParam("view", "Combined");
  const [range, setRange] = useParam("range", "month");
  const { data, error } = useLoad<Statement>(`/statements/cash-flow?period=${period}&view=${view}&range=${range}`);
  return (
    <>
      <div className="page-head no-print">
        <RangeSelect value={range} onChange={setRange} />
        <ViewSelect value={view} onChange={setView} />
        <Exports data={data} name={`cash-flow-${view}-${range}-${period}`} />
      </div>
      {error && <p className="error">{error}</p>}
      {data && <StatementView data={data} note={view === "Combined" ? "Whole business · direct method" : `${view} book · direct method`} check={{ ok: !!data.ties, ok_label: "Ties to the balance sheet", bad_label: "Does not tie to the balance sheet" }} />}
    </>
  );
}

function CashAccounts({ period }: { period: string }) {
  const [range, setRange] = useParam("range", "month");
  const { data, error } = useLoad<{ title: string; subtitle: string; status: Statement["status"]; accounts: { code: string; name: string; book: string; rows: StatementRow[]; ties: boolean }[] }>(
    `/statements/cash-accounts?period=${period}&range=${range}`,
  );
  return (
    <>
      <div className="page-head no-print">
        <RangeSelect value={range} onChange={setRange} />
        <button className="secondary" onClick={() => window.print()}>
          Print / PDF
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {data && !data.accounts.length && <p className="muted">No cash movements in this period.</p>}
      {data?.accounts.map((a) => (
        <StatementView
          key={a.code + a.book}
          data={{ title: `${a.code} ${a.name}`, subtitle: data.subtitle, status: data.status, columns: [{ key: "Amount", label: "Amount" }], rows: a.rows }}
          note={a.book === "Commissary" ? "Commissary book" : undefined}
          check={{ ok: a.ties, ok_label: "Ties to the ledger", bad_label: "Does not tie to the ledger" }}
        />
      ))}
    </>
  );
}

function ViewSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="Combined">Whole business</option>
      <option value="Store">Store book</option>
      <option value="Commissary">Commissary book</option>
    </select>
  );
}

function RangeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="month">Monthly</option>
      <option value="ytd">Year to date</option>
    </select>
  );
}

/** A number as shown on a statement: costs positive, negatives in parentheses, ₱ omitted. */
export function amount(cents: number): string {
  if (!cents) return "–";
  const s = formatPeso(Math.abs(cents)).replace("₱", "");
  return cents < 0 ? `(${s})` : s;
}
export const pct = (bp: number) => (bp ? `${(bp / 100).toFixed(1)}%` : "–");

function cell(r: StatementRow, c: Column): string {
  const v = r.values[c.key] ?? 0;
  if (c.kind || r.kind === "pct") return pct(v);
  return amount(v * r.sign);
}

export function StatementView({ data, note, check }: { data: Statement; note?: string; check?: { ok: boolean; ok_label: string; bad_label: string } }) {
  return (
    <div className="stmt">
      <div className="stmt-head">
        <div className="co">Quintet Allied Services &amp; Ventures Corp.</div>
        <div>Go Go Chicken · The Nest{note && ` · ${note}`}</div>
        <div className="t">{data.title}</div>
        <div className="muted">
          {data.subtitle} <span className={`badge ${data.status === "Final" ? "ok" : "info"}`}>{data.status}</span>
        </div>
      </div>
      <div className="table-wrap">
        <table className="stmt-table">
          <thead>
            <tr>
              <th>In Philippine pesos</th>
              {data.columns.map((c) => (
                <th key={c.key} className="num">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <Fragment key={i}>
                {r.kind === "section" || r.kind === "group" ? (
                  <tr className={r.kind === "section" ? "s-section" : "s-group"}>
                    <td colSpan={data.columns.length + 1}>{r.label}</td>
                  </tr>
                ) : (
                  <tr className={`s-${r.kind}`}>
                    <td>
                      {r.kind === "line" && r.codes?.length === 1 ? (
                        <Link className="plain" to={`/ledger/account?account=${r.codes[0]}`}>
                          {r.label}
                        </Link>
                      ) : (
                        r.label
                      )}
                    </td>
                    {data.columns.map((c) => (
                      <td key={c.key} className="num">
                        {cell(r, c)}
                      </td>
                    ))}
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {check && <p className={`badge ${check.ok ? "ok" : "error"}`}>{check.ok ? check.ok_label : check.bad_label}</p>}
    </div>
  );
}

function Exports({ data, name }: { data: Statement | null; name: string }) {
  function csv() {
    if (!data) return;
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = [
      ["Quintet Allied Services & Ventures Corp."],
      [data.title],
      [`${data.subtitle} (${data.status})`],
      [],
      ["", ...data.columns.map((c) => c.label)],
      ...data.rows.map((r) =>
        r.kind === "section" || r.kind === "group"
          ? [r.label]
          : [r.label, ...data.columns.map((c) => (c.kind || r.kind === "pct" ? pct(r.values[c.key] ?? 0) : (((r.values[c.key] ?? 0) * r.sign) / 100).toFixed(2)))],
      ),
    ];
    const blob = new Blob([lines.map((l) => l.map((x) => esc(String(x))).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  return (
    <>
      <button className="secondary" disabled={!data} onClick={csv}>
        Export CSV
      </button>
      <button className="secondary" disabled={!data} onClick={() => window.print()}>
        Print / PDF
      </button>
    </>
  );
}
