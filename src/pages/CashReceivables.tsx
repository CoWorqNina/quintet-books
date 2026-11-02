import { Fragment, useState } from "react";
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

/** Cash per account and receivables, with each account's movements on demand. */
export function CashReceivables() {
  const today = todayManila();
  const [from, setFrom] = useParam("from", `${today.slice(0, 7)}-01`);
  const [to, setTo] = useParam("to", today);
  const { data, error } = useLoad<CashData>(`/cash?from=${from}&to=${to}`);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpened((o) => (o.has(k) ? new Set([...o].filter((x) => x !== k)) : new Set([...o, k])));
  const isOpen = (k: string) => opened.has(k);
  const ready = data && data.from === from && data.to === to;

  const totals = ready
    ? data.cash.reduce((t, r) => ({ opening: t.opening + r.openingCents, in: t.in + r.inCents, out: t.out + r.outCents, closing: t.closing + r.closingCents }), { opening: 0, in: 0, out: 0, closing: 0 })
    : null;
  const recTotal = ready ? data.receivables.flatMap((g) => g.accounts).reduce((s, a) => s + a.balanceCents, 0) : 0;
  const currentRec = ready ? data.receivables.filter((g) => g.key !== "deposits" && g.key !== "books").flatMap((g) => g.accounts).reduce((s, a) => s + a.balanceCents, 0) : 0;

  return (
    <>
      <div className="page-head">
        <h1>Cash & Receivables</h1>
        <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        <span className="muted">to</span>
        <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
        <span className="muted">approved entries</span>
      </div>
      {error && <p className="error">{error}</p>}
      {!ready && !error && <p className="muted">Loading…</p>}
      {ready && totals && (
        <>
          <div className="tiles">
            <div className="tile">
              <span className="muted">Cash & banks at {to}</span>
              <strong>{peso(totals.closing)}</strong>
            </div>
            <div className="tile">
              <span className="muted">Money in</span>
              <strong>{peso(totals.in)}</strong>
              <small className="muted">incl. transfers between accounts</small>
            </div>
            <div className="tile">
              <span className="muted">Money out</span>
              <strong>{peso(totals.out)}</strong>
            </div>
            <div className="tile">
              <span className="muted">Receivables (current)</span>
              <strong>{peso(currentRec)}</strong>
              <small className="muted">plus deposits: {peso(recTotal - currentRec)}</small>
            </div>
          </div>

          <div className="card">
            <h2>Cash, banks & e-wallets</h2>
            <p className="muted">Click an account to see where its money came from and went, and every movement.</p>
            <div className="table-wrap">
              <table className="payables">
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", minWidth: "16rem" }}>Account</th>
                    <th>Opening {from}</th>
                    <th>In</th>
                    <th>Out</th>
                    <th>Closing {to}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cash.map((r) => (
                    <Fragment key={r.code}>
                      <tr className="clickable" onClick={() => toggle(`cash:${r.code}`)}>
                        <td>
                          {isOpen(`cash:${r.code}`) ? "▾" : "▸"} {r.code} {r.name}
                          {r.book === "Commissary" && <span className="badge muted-badge"> Commissary</span>}
                        </td>
                        <td className="num">{peso(r.openingCents)}</td>
                        <td className="num">{blank(r.inCents)}</td>
                        <td className="num">{blank(r.outCents)}</td>
                        <td className={`num ${r.closingCents < 0 ? "error" : ""}`}>
                          <strong>{peso(r.closingCents)}</strong>
                        </td>
                      </tr>
                      {isOpen(`cash:${r.code}`) && (
                        <tr>
                          <td colSpan={5} className="detail-cell">
                            <div className="grid2">
                              <FlowList title="Came from" flows={r.inflows} />
                              <FlowList title="Went to" flows={r.outflows} />
                            </div>
                            <MovementList account={r.code} from={from} to={to} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
          </div>

          <div className="card">
            <h2>Receivables at {to}</h2>
            <p className="muted">What others owe the business. Click an account for who owes it and its movements.</p>
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
                            <tr className="clickable" onClick={() => toggle(`rec:${a.code}`)}>
                              <td>
                                {isOpen(`rec:${a.code}`) ? "▾" : "▸"} {a.code} {a.name}
                                {a.book === "Commissary" && <span className="badge muted-badge"> Commissary</span>}
                              </td>
                              <td className={late ? "error" : "muted"}>
                                {a.parties.length ? `${oldest} days` : ""}
                                {late && ` (over ${a.limitDays})`}
                              </td>
                              <td className={`num ${a.balanceCents < 0 ? "error" : ""}`}>{peso(a.balanceCents)}</td>
                            </tr>
                            {isOpen(`rec:${a.code}`) && (
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
        </>
      )}
    </>
  );
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
        Movements {from} to {to} ·{" "}
        <Link to={`/ledger/account?account=${account}&from=${from}&to=${to}`} onClick={(e) => e.stopPropagation()}>
          open in the General Ledger
        </Link>
      </span>
      <table className="lines movements">
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Date</th>
            <th style={{ textAlign: "left" }}>What</th>
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
