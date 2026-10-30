import { useMemo } from "react";
import { Link, NavLink, Route, Routes, useNavigate, useSearchParams } from "react-router-dom";
import { monthEnd, type TrialBalanceRow } from "../../shared/ledger";
import { formatPeso } from "../../shared/money";
import type { Account } from "../../shared/types";
import { AttachmentLinks } from "../components/inputs";
import { todayManila, useAccounts, useLoad } from "../lib/data";
import { SubLedgers, SupplierCosts } from "./SubLedgers";

export const peso = (cents: number) => formatPeso(cents);
/** Debit-positive balance shown on its side. */
export const side = (cents: number) => (cents === 0 ? "—" : `${formatPeso(Math.abs(cents))} ${cents > 0 ? "Dr" : "Cr"}`);

/** Accounting cycle views: trial balance, general ledger / T-accounts, sub-ledgers, supplier costs. */
export default function Ledger() {
  return (
    <section>
      <nav className="tabs">
        <NavLink to="/ledger" end>
          Trial balance
        </NavLink>
        <NavLink to="/ledger/account">General ledger</NavLink>
        <NavLink to="/ledger/sub">Sub-ledgers</NavLink>
        <NavLink to="/ledger/costs">Supplier costs</NavLink>
      </nav>
      <Routes>
        <Route index element={<TrialBalance />} />
        <Route path="account" element={<GeneralLedger />} />
        <Route path="sub" element={<SubLedgers />} />
        <Route path="costs" element={<SupplierCosts />} />
      </Routes>
    </section>
  );
}

export function useParam(name: string, fallback: string): [string, (v: string) => void] {
  const [params, setParams] = useSearchParams();
  return [
    params.get(name) ?? fallback,
    (v) => {
      const next = new URLSearchParams(params);
      next.set(name, v);
      setParams(next, { replace: true });
    },
  ];
}

export function BookSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="Combined">Both books</option>
      <option value="Store">Store book</option>
      <option value="Commissary">Commissary book</option>
    </select>
  );
}

interface TB {
  period: string;
  asOf: string;
  status: string | null;
  rows: TrialBalanceRow[];
  totals: { debitCents: number; creditCents: number };
}

function TrialBalance() {
  const [period, setPeriod] = useParam("period", todayManila().slice(0, 7));
  const [mode, setMode] = useParam("mode", "adjusted");
  const [book, setBook] = useParam("book", "Combined");
  const { data, error } = useLoad<TB>(`/ledger/trial-balance?period=${period}&mode=${mode}&book=${book}`);
  const balanced = data && data.totals.debitCents === data.totals.creditCents;
  const from = `${period}-01`;

  return (
    <>
      <div className="page-head">
        <h1>Trial balance</h1>
        <input type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="unadjusted">Unadjusted</option>
          <option value="adjusted">Adjusted</option>
          <option value="post-closing">Post-closing</option>
        </select>
        <BookSelect value={book} onChange={setBook} />
      </div>
      <p className="muted">
        As of {data?.asOf ?? monthEnd(period)} · Approved entries only · income and expenses year to date
        {mode === "unadjusted" && " · before this month's adjusting entries"}
        {data?.status && ` · month ${data.status === "Final" ? "Final" : "Open (Preliminary)"}`}
      </p>
      {error && <p className="error">{error}</p>}
      {data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th className="num">Debit</th>
                <th className="num">Credit</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.code}>
                  <td>
                    <Link to={`/ledger/account?account=${r.code}&book=${book}&from=${from}&to=${data.asOf}`}>
                      {r.code} {r.name}
                    </Link>
                    {r.note && <span className="muted"> · {r.note}</span>}
                  </td>
                  <td className="num">{r.balanceCents > 0 ? peso(r.balanceCents) : ""}</td>
                  <td className="num">{r.balanceCents < 0 ? peso(-r.balanceCents) : ""}</td>
                </tr>
              ))}
              {!data.rows.length && (
                <tr>
                  <td colSpan={3} className="muted">
                    No approved entries yet.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="header-row">
                <td>
                  Total <span className={`badge ${balanced ? "ok" : "error"}`}>{balanced ? "Balanced" : "Out of balance"}</span>
                </td>
                <td className="num">{peso(data.totals.debitCents)}</td>
                <td className="num">{peso(data.totals.creditCents)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}

interface GLLine {
  entryId: number;
  date: string;
  kind: string;
  transactionType: number | null;
  book: string;
  description: string | null;
  sourceDocument: string | null;
  profitCenter: string | null;
  partyName: string | null;
  memo: string | null;
  debitCents: number;
  creditCents: number;
  balanceCents: number;
  attachments: { path: string; name: string; type: string; size: number }[];
}
interface GL {
  account: Account;
  openingCents: number;
  openingNote: string | null;
  lines: GLLine[];
  debitCents: number;
  creditCents: number;
  closingCents: number;
}

function GeneralLedger() {
  const navigate = useNavigate();
  const accountList = useAccounts();
  const month = todayManila().slice(0, 7);
  const [account, setAccount] = useParam("account", "");
  const [book, setBook] = useParam("book", "Combined");
  const [from, setFrom] = useParam("from", `${month}-01`);
  const [to, setTo] = useParam("to", monthEnd(month));
  const [view, setView] = useParam("view", "list");
  const { data, error } = useLoad<GL>(account ? `/ledger/account?account=${account}&book=${book}&from=${from}&to=${to}` : null);
  const postable = useMemo(() => accountList.filter((a) => !a.isHeader), [accountList]);
  const month1 = from.slice(0, 7);

  return (
    <>
      <div className="page-head">
        <h1>{view === "t" ? "T-account" : "General ledger"}</h1>
        <select value={account} onChange={(e) => setAccount(e.target.value)}>
          <option value="">Choose an account…</option>
          {postable.map((a) => (
            <option key={a.code} value={a.code}>
              {a.code} {a.name}
            </option>
          ))}
        </select>
        <BookSelect value={book} onChange={setBook} />
        {view === "t" ? (
          <input
            type="month"
            value={month1}
            onChange={(e) => {
              if (!e.target.value) return;
              navigate(`/ledger/account?account=${account}&book=${book}&view=t&from=${e.target.value}-01&to=${monthEnd(e.target.value)}`, { replace: true });
            }}
          />
        ) : (
          <>
            <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
            <span className="muted">to</span>
            <input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </>
        )}
        <select
          value={view}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "t") navigate(`/ledger/account?account=${account}&book=${book}&view=t&from=${month1}-01&to=${monthEnd(month1)}`, { replace: true });
            else setView(v);
          }}
        >
          <option value="list">Running balance</option>
          <option value="t">T-account (one month)</option>
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      {!account && <p className="muted">Choose an account to see its entries.</p>}
      {data && view === "t" && <TAccount gl={data} />}
      {data && view !== "t" && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Entry</th>
                <th>Description</th>
                <th className="num">Debit</th>
                <th className="num">Credit</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="header-row">
                <td>{from}</td>
                <td colSpan={4}>Opening balance{data.openingNote && <span className="muted"> · {data.openingNote}</span>}</td>
                <td className="num">{side(data.openingCents)}</td>
              </tr>
              {data.lines.map((l) => (
                <tr key={`${l.entryId}-${l.date}-${l.debitCents}-${l.creditCents}-${l.balanceCents}`}>
                  <td>{l.date}</td>
                  <td>
                    <Link to={`/journal?entry=${l.entryId}`}>#{l.entryId}</Link>
                    {book === "Combined" && <span className="muted"> · {l.book}</span>}
                  </td>
                  <td className="wrap">
                    {l.description}
                    {l.partyName && <span className="muted"> · {l.partyName}</span>}
                    {l.profitCenter && <span className="muted"> · {l.profitCenter}</span>}
                    {l.memo && <span className="muted"> · {l.memo}</span>}
                    {l.sourceDocument && <span className="muted"> · ref {l.sourceDocument}</span>} <AttachmentLinks items={l.attachments} />
                  </td>
                  <td className="num">{l.debitCents ? peso(l.debitCents) : ""}</td>
                  <td className="num">{l.creditCents ? peso(l.creditCents) : ""}</td>
                  <td className="num">{side(l.balanceCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="header-row">
                <td colSpan={3}>Totals and closing balance</td>
                <td className="num">{peso(data.debitCents)}</td>
                <td className="num">{peso(data.creditCents)}</td>
                <td className="num">{side(data.closingCents)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}

function TAccount({ gl }: { gl: GL }) {
  const debits = gl.lines.filter((l) => l.debitCents);
  const credits = gl.lines.filter((l) => l.creditCents);
  const item = (l: GLLine, cents: number) => (
    <tr key={`${l.entryId}-${cents}-${l.balanceCents}`}>
      <td>
        {l.date.slice(5)} <Link to={`/journal?entry=${l.entryId}`}>#{l.entryId}</Link>
      </td>
      <td className="num">{peso(cents)}</td>
    </tr>
  );
  return (
    <div className="card">
      <h2 className="center-text">
        {gl.account.code} {gl.account.name}
      </h2>
      <div className="t-account">
        <table>
          <thead>
            <tr>
              <th colSpan={2}>Debit</th>
            </tr>
          </thead>
          <tbody>
            {gl.openingCents > 0 && (
              <tr className="header-row">
                <td>Opening</td>
                <td className="num">{peso(gl.openingCents)}</td>
              </tr>
            )}
            {debits.map((l) => item(l, l.debitCents))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="num">{peso(gl.debitCents + Math.max(gl.openingCents, 0))}</td>
            </tr>
            <tr className="header-row">
              <td>{gl.closingCents > 0 ? "Closing" : "\u00a0"}</td>
              <td className="num">{gl.closingCents > 0 ? peso(gl.closingCents) : ""}</td>
            </tr>
          </tfoot>
        </table>
        <table>
          <thead>
            <tr>
              <th colSpan={2}>Credit</th>
            </tr>
          </thead>
          <tbody>
            {gl.openingCents < 0 && (
              <tr className="header-row">
                <td>Opening</td>
                <td className="num">{peso(-gl.openingCents)}</td>
              </tr>
            )}
            {credits.map((l) => item(l, l.creditCents))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="num">{peso(gl.creditCents + Math.max(-gl.openingCents, 0))}</td>
            </tr>
            <tr className="header-row">
              <td>{gl.closingCents < 0 ? "Closing" : "\u00a0"}</td>
              <td className="num">{gl.closingCents < 0 ? peso(-gl.closingCents) : ""}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
