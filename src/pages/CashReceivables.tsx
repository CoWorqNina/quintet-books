import { Fragment, type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { formatPeso } from "../../shared/money";
import { todayManila, useLoad } from "../lib/data";
import { useParam } from "./Ledger";

interface Flow {
  against: string;
  name: string;
  cents: number;
  isCash: boolean;
}
interface CashRow {
  code: string;
  name: string;
  book: string | null;
  openingCents: number;
  inCents: number;
  outCents: number;
  closingCents: number;
  inflows: Flow[];
  outflows: Flow[];
}
interface RecAccount {
  code: string;
  name: string;
  book: string | null;
  balanceCents: number;
  limitDays: number | null;
  parties: { party: string; balanceCents: number; oldestDays: number; items: number }[];
}
interface CashData {
  from: string;
  to: string;
  cash: CashRow[];
  receivables: { key: string; label: string; accounts: RecAccount[] }[];
}
interface Movement {
  entryId: number;
  date: string;
  description: string | null;
  reference: string | null;
  party: string | null;
  memo: string | null;
  inCents: number;
  outCents: number;
  balanceCents: number;
  against: { code: string; name: string }[];
}
interface Movements {
  account: { code: string; name: string };
  from: string;
  to: string;
  openingCents: number;
  lines: Movement[];
  inCents: number;
  outCents: number;
  closingCents: number;
}

const peso = (c: number) => formatPeso(c);
const blank = (c: number) => (c ? peso(c) : "—");

/**
 * Cash register: one tab per cash, bank and e-wallet account listing every transaction with
 * money in, money out and the running balance; plus all accounts at a glance and receivables.
 */
export function CashReceivables() {
  const today = todayManila();
  const [from, setFrom] = useParam("from", `${today.slice(0, 7)}-01`);
  const [to, setTo] = useParam("to", today);
  const [view, setView] = useParam("view", "");
  const { data, error } = useLoad<CashData>(`/cash?from=${from}&to=${to}`);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpened((o) => (o.has(k) ? new Set([...o].filter((x) => x !== k)) : new Set([...o, k])));
  const isOpen = (k: string) => opened.has(k);
  const ready = data && data.from === from && data.to === to;
  const current = view || data?.cash[0]?.code || "all";
  const account = ready ? data.cash.find((r) => r.code === current) : undefined;

  const totals = ready
    ? data.cash.reduce((t, r) => ({ opening: t.opening + r.openingCents, in: t.in + r.inCents, out: t.out + r.outCents, closing: t.closing + r.closingCents }), { opening: 0, in: 0, out: 0, closing: 0 })
    : null;
  const recTotal = ready ? data.receivables.flatMap((g) => g.accounts).reduce((s, a) => s + a.balanceCents, 0) : 0;
  const tab = (key: string, label: ReactNode) => (
    <a
      key={key}
      href="#"
      className={current === key ? "active" : ""}
      onClick={(e) => {
        e.preventDefault();
        setView(key);
      }}
    >
      {label}
    </a>
  );

  return (
    <>
      <div className="page-head">
        <h1>Cash Register</h1>
        <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        <span className="muted">to</span>
        <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
        <span className="muted">approved entries</span>
      </div>
      {error && <p className="error">{error}</p>}
      {!ready && !error && <p className="muted">Loading…</p>}
      {ready && totals && (
        <>
          <nav className="tabs">
            {data.cash.map((r) =>
              tab(
                r.code,
                <>
                  {short(r.name)} <span className="muted small">{peso(r.closingCents)}</span>
                </>,
              ),
            )}
            {tab(
              "all",
              <>
                All accounts <span className="muted small">{peso(totals.closing)}</span>
              </>,
            )}
            {tab(
              "receivables",
              <>
                Receivables <span className="muted small">{peso(recTotal)}</span>
              </>,
            )}
          </nav>

          {account && (
            <div className="card">
              <div className="page-head" style={{ marginBottom: 0 }}>
                <h2 style={{ margin: 0 }}>
                  {account.code} {account.name}
                </h2>
                {account.book === "Commissary" && <span className="badge muted-badge">Commissary</span>}
              </div>
              <div className="tiles">
                <div className="tile">
                  <span className="muted">Opening {from}</span>
                  <strong>{peso(account.openingCents)}</strong>
                </div>
                <div className="tile">
                  <span className="muted">Money in</span>
                  <strong>{peso(account.inCents)}</strong>
                </div>
                <div className="tile">
                  <span className="muted">Money out</span>
                  <strong>{peso(account.outCents)}</strong>
                </div>
                <div className="tile">
                  <span className="muted">Balance {to}</span>
                  <strong className={account.closingCents < 0 ? "error" : ""}>{peso(account.closingCents)}</strong>
                </div>
              </div>
              <MovementList account={account.code} from={from} to={to} />
              <details style={{ marginTop: "1rem" }}>
                <summary>Where the money came from and went (totals)</summary>
                <div className="grid2" style={{ marginTop: "0.5rem" }}>
                  <FlowList title="Came from" flows={account.inflows} />
                  <FlowList title="Went to" flows={account.outflows} />
                </div>
              </details>
            </div>
          )}

          {current === "all" && (
            <div className="card">
              <h2>All cash, banks & e-wallets</h2>
              <div className="table-wrap">
                <table className="payables">
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", minWidth: "16rem" }}>Account</th>
                      <th>Opening {from}</th>
                      <th>In</th>
                      <th>Out</th>
                      <th>Balance {to}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.cash.map((r) => (
                      <tr key={r.code} className="clickable" onClick={() => setView(r.code)}>
                        <td>
                          {r.code} {r.name}
                          {r.book === "Commissary" && <span className="badge muted-badge"> Commissary</span>}
                        </td>
                        <td className="num">{peso(r.openingCents)}</td>
                        <td className="num">{blank(r.inCents)}</td>
                        <td className="num">{blank(r.outCents)}</td>
                        <td className={`num ${r.closingCents < 0 ? "error" : ""}`}>
                          <strong>{peso(r.closingCents)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="num">{peso(totals.opening)}</td>
                      <td className="num">{peso(totals.in)}</td>
                      <td className="num">{peso(totals.out)}</td>
                      <td className="num">
                        <strong>{peso(totals.closing)}</strong>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="muted small">In and out include transfers between your own accounts (e.g. cash on hand deposited to the bank).</p>
            </div>
          )}

          {current === "receivables" && (
            <div className="card">
              <h2>Receivables at {to}</h2>
              <p className="muted">What others owe the business. Click an account for who owes it and its in / out / balance.</p>
              <div className="table-wrap">
                <table className="payables">
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>Account</th>
                      <th style={{ textAlign: "left" }}>Oldest unpaid</th>
                      <th>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.receivables.length === 0 && (
                      <tr>
                        <td colSpan={3} className="muted">
                          No receivables.
                        </td>
                      </tr>
                    )}
                    {data.receivables.map((g) => (
                      <Fragment key={g.key}>
                        <tr className="group-row">
                          <td colSpan={2}>
                            <strong>{g.label}</strong>
                          </td>
                          <td className="num">
                            <strong>{peso(g.accounts.reduce((s, a) => s + a.balanceCents, 0))}</strong>
                          </td>
                        </tr>
                        {g.accounts.map((a) => {
                          const oldest = Math.max(0, ...a.parties.map((p) => p.oldestDays));
                          const late = a.limitDays !== null && oldest > a.limitDays;
                          return (
                            <Fragment key={a.code}>
                              <tr className="clickable" onClick={() => toggle(a.code)}>
                                <td>
                                  {isOpen(a.code) ? "▾" : "▸"} {a.code} {a.name}
                                  {a.book === "Commissary" && <span className="badge muted-badge"> Commissary</span>}
                                </td>
                                <td className={late ? "error" : "muted"}>
                                  {a.parties.length ? `${oldest} days` : ""}
                                  {late && ` (over ${a.limitDays})`}
                                </td>
                                <td className={`num ${a.balanceCents < 0 ? "error" : ""}`}>{peso(a.balanceCents)}</td>
                              </tr>
                              {isOpen(a.code) && (
                                <tr>
                                  <td colSpan={3} className="detail-cell">
                                    {a.parties.some((p) => p.party) && (
                                      <table className="lines">
                                        <tbody>
                                          {a.parties.map((p) => (
                                            <tr key={p.party}>
                                              <td>{p.party || "(no name)"}</td>
                                              <td className="muted">
                                                {p.items} open · oldest {p.oldestDays} days
                                              </td>
                                              <td className="num">{peso(p.balanceCents)}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    )}
                                    <MovementList account={a.code} from={from} to={to} />
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2}>Total</td>
                      <td className="num">
                        <strong>{peso(recTotal)}</strong>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

/** Tab label: "Cash in Bank – Security Bank" → "Security Bank", "E-Wallet – GCash" → "GCash". */
function short(name: string) {
  return name.replace(/^(Cash in Bank|E-Wallet) – /, "").replace(/^Cash on Hand – /, "Cash – ");
}

function FlowList({ title, flows }: { title: string; flows: Flow[] }) {
  return (
    <div>
      <span className="label">{title}</span>
      {flows.length === 0 ? (
        <p className="muted small">Nothing in this period.</p>
      ) : (
        <table className="lines">
          <tbody>
            {flows.map((f) => (
              <tr key={f.against}>
                <td>
                  {f.isCash ? "↔ " : ""}
                  {f.against} {f.name}
                </td>
                <td className="num">{peso(f.cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function MovementList({ account, from, to }: { account: string; from: string; to: string }) {
  const { data, error } = useLoad<Movements>(`/cash/movements?account=${account}&from=${from}&to=${to}`);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted small">Loading movements…</p>;
  return (
    <div style={{ marginTop: "0.75rem" }}>
      <span className="label">
        Transactions {from} to {to} ·{" "}
        <Link to={`/ledger/account?account=${account}&from=${from}&to=${to}`} onClick={(e) => e.stopPropagation()}>
          open in the General Ledger
        </Link>
      </span>
      <table className="lines movements">
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Date</th>
            <th style={{ textAlign: "left" }}>Particulars</th>
            <th style={{ textAlign: "left" }}>Against</th>
            <th>In</th>
            <th>Out</th>
            <th>Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{from}</td>
            <td colSpan={4} className="muted">
              Opening balance
            </td>
            <td className="num">{peso(data.openingCents)}</td>
          </tr>
          {data.lines.map((l, i) => (
            <tr key={`${l.entryId}-${i}`}>
              <td>{l.date}</td>
              <td>
                <Link to={`/journal?entry=${l.entryId}`}>#{l.entryId}</Link> {l.description}
                {(l.memo || l.party || l.reference) && <div className="muted small">{[l.party, l.memo, l.reference].filter(Boolean).join(" · ")}</div>}
              </td>
              <td className="small">{l.against.map((a) => `${a.code} ${a.name}`).join(", ")}</td>
              <td className="num">{l.inCents ? peso(l.inCents) : ""}</td>
              <td className="num">{l.outCents ? peso(l.outCents) : ""}</td>
              <td className={`num ${l.balanceCents < 0 ? "error" : ""}`}>{peso(l.balanceCents)}</td>
            </tr>
          ))}
          {data.lines.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                No movements in this period.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>Closing balance</td>
            <td className="num">{peso(data.inCents)}</td>
            <td className="num">{peso(data.outCents)}</td>
            <td className="num">
              <strong>{peso(data.closingCents)}</strong>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
