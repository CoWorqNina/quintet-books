import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatPeso } from "../../shared/money";
import { BUCKETS, bucketOf, PAYABLE_KINDS, type PayableItem, type PayableKind, type PayablesSummary, toPay, weeklyPlan } from "../../shared/payables";
import { useLoad } from "../lib/data";

const peso = (c: number) => formatPeso(c);
const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: "UTC" });

/** Everything owed, by when it falls due, against cash on hand: for planning payments. */
export function Payables({ canPay = true }: { canPay?: boolean }) {
  const { data, error } = useLoad<PayablesSummary>("/payables");
  const [kinds, setKinds] = useState<Set<PayableKind>>(new Set(PAYABLE_KINDS.map((k) => k.kind)));
  const [open, setOpen] = useState<Set<string>>(new Set(["overdue", "week"]));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const items = useMemo(() => (data?.items ?? []).filter((i) => kinds.has(i.kind)), [data, kinds]);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  const today = data.asOf;
  const byBucket = new Map(BUCKETS.map((b) => [b.key, items.filter((i) => bucketOf(i.dueDate, today) === b.key).sort(byDue)]));
  const sum = (list: PayableItem[]) => list.reduce((s, i) => s + toPay(i), 0);
  const overdue = sum(byBucket.get("overdue")!);
  const week = sum(byBucket.get("week")!);
  const month = sum(byBucket.get("month")!);
  const total = sum(items);
  const after30 = data.cashCents - overdue - week - month;
  const plan = weeklyPlan(items, data.cashCents, today);
  const toggleKind = (k: PayableKind) => setKinds((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k])));
  const payable = (i: PayableItem) => canPay && (i.key.startsWith("bill:") || i.key.startsWith("inst:")) && toPay(i) > 0;
  const chosen = (data.items ?? []).filter((i) => selected.has(i.key) && payable(i));
  const chosenBooks = new Set(chosen.map((i) => i.book));
  const toggleSelect = (k: string) => setSelected((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k])));
  const toggleOpen = (k: string) => setOpen((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k])));

  return (
    <>
      <div className="page-head">
        <h1>Payables</h1>
        <span className="muted">as of {today} · approved entries</span>
      </div>
      <div className="tiles">
        <div className="tile">
          <span className="muted">Cash & banks now</span>
          <strong>{peso(data.cashCents)}</strong>
        </div>
        <div className="tile">
          <span className="muted">Overdue</span>
          <strong className={overdue ? "error" : ""}>{peso(overdue)}</strong>
        </div>
        <div className="tile">
          <span className="muted">Due in the next 7 days</span>
          <strong>{peso(week)}</strong>
        </div>
        <div className="tile">
          <span className="muted">Due in 8–30 days</span>
          <strong>{peso(month)}</strong>
        </div>
        <div className="tile">
          <span className="muted">Cash left after the next 30 days</span>
          <strong className={after30 < 0 ? "error" : ""}>{peso(after30)}</strong>
          <small className="muted">if nothing comes in</small>
        </div>
        <div className="tile">
          <span className="muted">Total owed (these filters)</span>
          <strong>{peso(total)}</strong>
        </div>
      </div>

      <div className="picker" style={{ marginBottom: "0.5rem" }}>
        {PAYABLE_KINDS.map((k) => {
          const n = (data.items ?? []).filter((i) => i.kind === k.kind);
          return (
            <label key={k.kind} className="chip">
              <input type="checkbox" checked={kinds.has(k.kind)} onChange={() => toggleKind(k.kind)} />
              {k.label} <span className="muted">{peso(sum(n))}</span>
            </label>
          );
        })}
      </div>

      <div className="card">
        <h2>Cash plan by week</h2>
        <p className="muted">What falls due each week and the cash left after paying it, before any sales or collections come in.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>When</th>
                <th>Due</th>
                <th>Cash left after</th>
              </tr>
            </thead>
            <tbody>
              {plan.map((r) => (
                <tr key={r.label}>
                  <td>
                    {r.label}{" "}
                    <span className="muted">
                      {r.from && r.to ? `${short(r.from)} – ${short(r.to)}` : r.from ? `from ${short(r.from)}` : r.to ? `before ${short(today)}` : ""}
                    </span>
                  </td>
                  <td className={`num ${r.label === "Overdue" && r.dueCents ? "error" : ""}`}>{r.dueCents ? peso(r.dueCents) : "—"}</td>
                  <td className={`num ${r.cashAfterCents < 0 ? "error" : ""}`}>{peso(r.cashAfterCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Bills by due date</h2>
        <p className="muted small">Tick several to pay them in one transfer (e.g. everything on one owner's cards, SPayLater and card loans, paid to that owner).</p>
        {chosen.length > 0 && (
          <div className="notice row-actions" style={{ position: "sticky", top: 0, zIndex: 2 }}>
            <strong>
              {chosen.length} selected · {peso(chosen.reduce((s, i) => s + toPay(i), 0))}
            </strong>
            <span className="spacer" />
            {chosenBooks.size > 1 ? (
              <span className="error small">Store and Commissary bills are paid separately</span>
            ) : (
              <Link className="button" to={combinedLink(chosen)}>
                Pay selected in one transfer
              </Link>
            )}
            <button type="button" className="link" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        )}
        <div className="table-wrap">
          <table className="payables">
            <thead>
              <tr>
                <th />
                <th style={{ textAlign: "left" }}>Due</th>
                <th style={{ textAlign: "left" }}>Pay to</th>
                <th style={{ textAlign: "left" }}>For</th>
                <th>To pay</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {BUCKETS.map((b) => {
                const list = byBucket.get(b.key)!;
                const isOpen = open.has(b.key);
                return (
                  <Fragment key={b.key}>
                    <tr className="group-row" onClick={() => toggleOpen(b.key)} style={{ cursor: "pointer" }}>
                      <td colSpan={4}>
                        <strong className={b.key === "overdue" && list.length ? "error" : ""}>
                          {isOpen ? "▾" : "▸"} {b.label}
                        </strong>{" "}
                        <span className="muted">
                          {list.length} item{list.length === 1 ? "" : "s"}
                        </span>
                      </td>
                      <td className="num">
                        <strong>{peso(sum(list))}</strong>
                      </td>
                      <td />
                    </tr>
                    {isOpen &&
                      list.map((i) => (
                        <tr key={i.key}>
                          <td>{payable(i) && <input type="checkbox" aria-label="Select" checked={selected.has(i.key)} onChange={() => toggleSelect(i.key)} />}</td>
                          <td className={b.key === "overdue" ? "error" : ""}>
                            {i.dueDate ? short(i.dueDate) : "—"}
                            {b.key === "overdue" && i.dueDate && <div className="small">{daysLate(i.dueDate, today)} days late</div>}
                          </td>
                          <td>
                            {i.payee}
                            {i.book === "Commissary" && <span className="badge muted-badge"> Commissary</span>}
                            {i.payee !== i.accountName && (
                              <div className="muted small">
                                {i.accountCode} {i.accountName}
                              </div>
                            )}
                          </td>
                          <td>
                            {i.label}
                            {i.pendingCents > 0 && <div className="small muted">{peso(i.pendingCents)} in a payment waiting for approval</div>}
                          </td>
                          <td className="num">{peso(toPay(i))}</td>
                          <td>
                            {canPay && i.pay && toPay(i) > 0 && (
                              <span className="row-links">
                                <Link to={payLink(i)}>Pay</Link>
                                {i.key.startsWith("bill:") && <Link to={rescheduleLink(i)}>Reschedule</Link>}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Card and SPayLater bills are due on the statement date. Payroll, government contributions, accrued expenses and loans with no schedule show under "No due date"; they can be ticked and paid too. A
          payment waiting for approval is taken off what's left to pay.
        </p>
      </div>
    </>
  );
}

const byDue = (a: PayableItem, b: PayableItem) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "") || a.payee.localeCompare(b.payee);

function daysLate(due: string, today: string) {
  return Math.round((Date.parse(today) - Date.parse(due)) / 86_400_000);
}

function payLink(i: PayableItem) {
  const p = new URLSearchParams({ template: String(i.pay!.template), ...i.pay!.values });
  if (p.has("bill")) p.set("amount", (toPay(i) / 100).toFixed(2));
  if (i.book === "Commissary") p.set("book", "Commissary");
  return `/entries/new?${p}`;
}

/** Opens #44 Combined Payment with the selected bills and loan installments ticked. */
function combinedLink(items: PayableItem[]) {
  const list = items.map((i) => `${i.key}:${(toPay(i) / 100).toFixed(2)}`).join(",");
  const p = new URLSearchParams({ template: "44", items: list });
  if (items[0]?.book === "Commissary") p.set("book", "Commissary");
  return `/entries/new?${p}`;
}

/** Opens #45 Reschedule a Payable with this bill ticked (installments, new due date, added charges). */
function rescheduleLink(i: PayableItem) {
  const p = new URLSearchParams({ template: "45", account: i.accountCode, items: `${i.key}:${(toPay(i) / 100).toFixed(2)}` });
  if (i.book === "Commissary") p.set("book", "Commissary");
  return `/entries/new?${p}`;
}
