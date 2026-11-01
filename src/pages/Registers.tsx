import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ACCUMULATED_DEPRECIATION, accountMatches, DEFAULT_LIFE_MONTHS } from "../../shared/accounts";
import { buildSchedule } from "../../shared/loans";
import { formatPeso, fromCents, toCents } from "../../shared/money";
import type { AppUser, Book } from "../../shared/types";
import { api } from "../lib/api";
import { todayManila, useAccounts, useEmployees, useLoad } from "../lib/data";

interface Status {
  in_force: boolean;
  entry_id: number | null;
  entry_status: string | null;
}
interface Asset extends Status {
  id: number;
  name: string;
  book: Book;
  account_code: string;
  profit_center: string;
  cost: number;
  in_use_date: string;
  useful_life_months: number;
  depreciated_before_go_live: number;
  booked_since_go_live: number;
  popup: boolean;
  retired: { entryId: number; status: string; date: string } | null;
}
interface Spread extends Status {
  id: number;
  kind: string;
  name: string;
  asset_account: string;
  expense_account: string;
  profit_center: string;
  total: number;
  start_month: string;
  months: number;
  amortized_before_go_live: number;
  booked_since_go_live: number;
}
interface Loan extends Status {
  id: number;
  name: string;
  lender_name: string;
  account_code: string;
  principal: number;
  annual_rate: number;
  term_months: number;
  method: string | null;
  installment_amount: number | null;
  installments: LoanRowView[] | null;
}

interface LoanRowView {
  id: number;
  seq: number;
  due_date: string;
  principal: number;
  interest: number;
  paid: boolean;
  paid_before_go_live: boolean;
  paid_entry_id: number | null;
  date_paid: string | null;
  payment_status: string | null;
  interest_recorded: boolean;
  interest_entry_id: number | null;
  interest_status: string | null;
}

/** Paid / Due / Overdue, as of today. */
const rowStatus = (i: LoanRowView) => (i.paid ? "Paid" : i.due_date < todayManila() ? "Overdue" : "Due");

const peso = (n: number) => formatPeso(toCents(n));

function StatusBadge({ r }: { r: Status }) {
  if (!r.entry_id) return <span className="badge">Go-live</span>;
  if (!r.in_force) return <span className="badge muted-badge">Reversed / cancelled</span>;
  return <span className={`badge ${r.entry_status === "Approved" ? "ok" : "info"}`}>{r.entry_status}</span>;
}

/** Straight-line figures for one asset (pesos): monthly charge, net at go-live, net now, months left. */
function assetFigures(a: Asset) {
  const cost = Number(a.cost);
  const before = Number(a.depreciated_before_go_live);
  const since = Number(a.booked_since_go_live ?? 0);
  const monthly = Math.round((cost / a.useful_life_months) * 100) / 100;
  const netNow = cost - before - since;
  return { cost, monthly, before, netGoLive: cost - before, since, netNow, monthsLeft: monthly ? Math.max(0, Math.round(netNow / monthly)) : 0 };
}

/** Fixed Asset Register, prepaid and deferred spreads, and the Loan Tracker. */
export default function Registers({ user }: { user: AppUser }) {
  const { data, error, reload } = useLoad<{ assets: Asset[]; spreads: Spread[]; loans: Loan[] }>("/registers");
  const [adding, setAdding] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const live = <T extends Status>(rows: T[] = []) => (showAll ? rows : rows.filter((r) => r.in_force));
  const [retiring, setRetiring] = useState<number | null>(null);
  const canRetire = user.role === "Owner" || user.role === "Accountant";
  // Assets written off (approved) leave the totals; the row stays for the record.
  const active = (assets: Asset[] = []) => live(assets).filter((a) => a.retired?.status !== "Approved");

  return (
    <section className="wide">
      <div className="page-head">
        <h1>Registers</h1>
        <label className="inline">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show reversed
        </label>
        {user.role === "Owner" && <button onClick={() => setAdding(!adding)}>{adding ? "Close" : "Add go-live record"}</button>}
      </div>
      <p className="muted">
        Records are created with their entries (#29 assets, #31 prepaids, #33 loans). Assets, prepaids and loans that already exist on
        October 31, 2026 are added here as go-live records and must agree with the opening balances.
      </p>
      {adding && (
        <GoLiveForm
          onDone={() => {
            setAdding(false);
            reload();
          }}
        />
      )}
      {error && <p className="error">{error}</p>}

      <h2>Fixed assets</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Class</th>
              <th>Tag</th>
              <th>In use</th>
              <th>Life</th>
              <th className="num">Cost</th>
              <th className="num">Monthly</th>
              <th className="num" title="Depreciation up to Oct 31, 2026">To Oct 31</th>
              <th className="num">Net at go-live</th>
              <th className="num" title="Depreciation booked since Nov 1, 2026">Since Nov 1</th>
              <th className="num">Net now</th>
              <th className="num">Left</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {live(data?.assets).map((a) => {
              const f = assetFigures(a);
              const gone = a.retired?.status === "Approved";
              return (
                <Fragment key={a.id}>
                <tr className={gone ? "inactive" : ""}>
                  <td>
                    {a.name}
                    {a.popup && <span className="muted"> · pop-ups</span>}
                  </td>
                  <td>{a.account_code}</td>
                  <td>{a.profit_center}</td>
                  <td>{a.in_use_date}</td>
                  <td>{a.useful_life_months}m</td>
                  <td className="num">{peso(a.cost)}</td>
                  <td className="num">{peso(f.monthly)}</td>
                  <td className="num">{peso(a.depreciated_before_go_live)}</td>
                  <td className="num">{peso(f.netGoLive)}</td>
                  <td className="num">{peso(a.booked_since_go_live)}</td>
                  <td className="num">{peso(f.netNow)}</td>
                  <td className="num">{f.monthsLeft}</td>
                  <td>
                    {a.retired ? (
                      <Link className={`badge ${gone ? "muted-badge" : "info"}`} to={`/journal?entry=${a.retired.entryId}`}>
                        Retired {a.retired.date} {gone ? "" : `(${a.retired.status})`}
                      </Link>
                    ) : (
                      <>
                        <StatusBadge r={a} />{" "}
                        {canRetire && a.in_force && (!a.entry_id || a.entry_status === "Approved") && (
                          <button className="link" onClick={() => setRetiring(retiring === a.id ? null : a.id)}>
                            {retiring === a.id ? "Close" : "Retire"}
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
                {retiring === a.id && (
                  <tr>
                    <td colSpan={13}>
                      <RetireForm
                        asset={a}
                        onDone={() => {
                          setRetiring(null);
                          reload();
                        }}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="header-row">
              <td colSpan={5}>Total (in use)</td>
              {(["cost", "monthly", "before", "netGoLive", "since", "netNow"] as const).map((k) => (
                <td key={k} className="num">
                  {peso(active(data?.assets).reduce((s, a) => s + assetFigures(a)[k], 0))}
                </td>
              ))}
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      <h2>Prepaid and deferred spreads</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Kind</th>
              <th>Accounts</th>
              <th>Tag</th>
              <th>From</th>
              <th>Months</th>
              <th className="num">Total</th>
              <th className="num">Monthly</th>
              <th className="num" title="Amortization up to Oct 31, 2026">To Oct 31</th>
              <th className="num">Net at go-live</th>
              <th className="num" title="Amortization booked since Nov 1, 2026">Since Nov 1</th>
              <th className="num">Net now</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {live(data?.spreads).map((s) => {
              const total = Number(s.total);
              const before = Number(s.amortized_before_go_live);
              return (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.kind}</td>
                  <td>
                    {s.asset_account} → {s.expense_account}
                  </td>
                  <td>{s.profit_center}</td>
                  <td>{s.start_month.slice(0, 7)}</td>
                  <td>{s.months}</td>
                  <td className="num">{peso(total)}</td>
                  <td className="num">{peso(Math.round((total / s.months) * 100) / 100)}</td>
                  <td className="num">{peso(before)}</td>
                  <td className="num">{peso(total - before)}</td>
                  <td className="num">{peso(s.booked_since_go_live)}</td>
                  <td className="num">{peso(total - before - s.booked_since_go_live)}</td>
                  <td>
                    <StatusBadge r={s} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>Loans</h2>
      <p className="muted">
        Straight-line schedules: the same principal and interest every month, the last month absorbing rounding. Each row's interest is booked
        once, by the month-end accrual or by the payment.
      </p>
      {live(data?.loans).map((l) => {
        const inst = l.installments ?? [];
        const paid = inst.filter((i) => i.paid);
        const balance = Number(l.principal) - paid.reduce((s, i) => s + Number(i.principal), 0);
        const totalInterest = inst.reduce((s, i) => s + Number(i.interest), 0);
        const accrued = inst.filter((i) => i.interest_entry_id && !i.paid).reduce((s, i) => s + Number(i.interest), 0);
        const overdue = inst.filter((i) => rowStatus(i) === "Overdue").length;
        return (
          <details key={l.id} className="card">
            <summary>
              <strong>{l.name}</strong> · {l.lender_name} · {l.account_code} · {peso(l.principal)} · {l.installment_amount ? `${peso(l.installment_amount)} × ${l.term_months}` : `${l.term_months} months`} ·
              total interest {peso(totalInterest)} · {paid.length}/{inst.length} paid · balance {peso(balance)}
              {accrued > 0 && ` · interest payable ${peso(accrued)}`} {overdue > 0 && <span className="badge error">{overdue} overdue</span>} <StatusBadge r={l} />
            </summary>
            <div className="table-wrap">
              <table className="lines">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Period</th>
                    <th>Due</th>
                    <th className="num">Payment</th>
                    <th className="num">Principal</th>
                    <th className="num">Interest</th>
                    <th>Interest recorded</th>
                    <th>Paid</th>
                    <th className="num">Remaining balance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {inst.map((i) => {
                    const after = Math.round((Number(l.principal) - inst.filter((x) => x.seq <= i.seq).reduce((t, x) => t + Number(x.principal), 0)) * 100) / 100;
                    const st = rowStatus(i);
                    return (
                      <tr key={i.id}>
                        <td>{i.seq}</td>
                        <td>{i.due_date.slice(0, 7)}</td>
                        <td>{i.due_date}</td>
                        <td className="num">{peso(Number(i.principal) + Number(i.interest))}</td>
                        <td className="num">{peso(i.principal)}</td>
                        <td className="num">{peso(i.interest)}</td>
                        <td>
                          {i.paid_before_go_live ? (
                            <span className="muted">Before go-live</span>
                          ) : i.interest_entry_id ? (
                            <Link to={`/journal?entry=${i.interest_entry_id}`}>Accrued #{i.interest_entry_id}</Link>
                          ) : i.interest_recorded ? (
                            <span className="muted">With payment</span>
                          ) : (
                            ""
                          )}
                        </td>
                        <td>
                          {i.paid_before_go_live ? (
                            <span className="muted">Before go-live</span>
                          ) : i.paid_entry_id ? (
                            <Link to={`/journal?entry=${i.paid_entry_id}`}>
                              {i.date_paid} #{i.paid_entry_id}
                              {i.payment_status !== "Approved" ? ` (${i.payment_status})` : ""}
                            </Link>
                          ) : (
                            ""
                          )}
                        </td>
                        <td className="num">{peso(after)}</td>
                        <td>
                          <span className={`badge ${st === "Paid" ? "ok" : st === "Overdue" ? "error" : "info"}`}>{st}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}
    </section>
  );
}

interface RetirePreview {
  figures: { costCents: number; catchUpCents: number; accumulatedCents: number; bookValueCents: number; lossCents: number; gainCents: number; chargeAboveBookCents: number };
  errors: string[];
}

/** Write off a broken, lost or sold asset; previews the loss before saving. */
function RetireForm({ asset, onDone }: { asset: Asset; onDone: () => void }) {
  const accountList = useAccounts();
  const employees = useEmployees();
  const [date, setDate] = useState(todayManila());
  const [reason, setReason] = useState("");
  const [employee, setEmployee] = useState("");
  const [charge, setCharge] = useState("");
  const [sale, setSale] = useState("");
  const [saleAccount, setSaleAccount] = useState("");
  const [preview, setPreview] = useState<RetirePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const body = JSON.stringify({ date, reason, employee: employee || undefined, charge: Number(charge) || 0, sale: Number(sale) || 0, saleAccount: saleAccount || undefined });

  useEffect(() => {
    const t = setTimeout(() => {
      api<RetirePreview>(`/registers/assets/${asset.id}/retire?preview=1`, { method: "POST", body })
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 300);
    return () => clearTimeout(t);
  }, [body, asset.id]);

  async function save() {
    if (!confirm(`Retire ${asset.name}? It goes to an Owner for approval.`)) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/registers/assets/${asset.id}/retire`, { method: "POST", body });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
    }
    setBusy(false);
  }

  const f = preview?.figures;
  const p = (c: number) => formatPeso(c);
  return (
    <div className="row-card">
      <strong>Retire {asset.name}</strong>
      <p className="muted">
        Depreciation runs through the month before it's retired (none in the month it goes). What's left of its value is a loss, reduced by any
        amount charged to an employee or received from a sale.
      </p>
      <div className="grid3">
        <label>
          Date it broke / was lost or sold
          <input type="date" value={date} max={todayManila()} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="span2">
          What happened
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Compressor broke, not worth repairing" />
        </label>
        <label>
          Charge to employee (optional)
          <select value={employee} onChange={(e) => setEmployee(e.target.value)}>
            <option value="">No one</option>
            {employees.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Amount charged
          <input type="number" step="0.01" min="0" value={charge} disabled={!employee} onChange={(e) => setCharge(e.target.value)} />
        </label>
        <span />
        <label>
          Sold for (optional)
          <input type="number" step="0.01" min="0" value={sale} onChange={(e) => setSale(e.target.value)} />
        </label>
        <label>
          Money received in
          <select value={saleAccount} disabled={!Number(sale)} onChange={(e) => setSaleAccount(e.target.value)}>
            <option value="">Choose…</option>
            {accountList
              .filter((x) => x.isCashAccount && !x.isHeader && x.active)
              .map((x) => (
                <option key={x.code} value={x.code}>
                  {x.code} {x.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      {f && (
        <table className="lines">
          <tbody>
            <tr>
              <td>Cost</td>
              <td className="num">{p(f.costCents)}</td>
            </tr>
            {f.catchUpCents > 0 && (
              <tr>
                <td>Depreciation still to book through last month</td>
                <td className="num">{p(f.catchUpCents)}</td>
              </tr>
            )}
            <tr>
              <td>Accumulated depreciation</td>
              <td className="num">({p(f.accumulatedCents)})</td>
            </tr>
            <tr>
              <td>
                <strong>Book value written off</strong>
              </td>
              <td className="num">
                <strong>{p(f.bookValueCents)}</strong>
              </td>
            </tr>
            {Number(charge) > 0 && employee && (
              <tr>
                <td>Charged to {employees.find((x) => x.id === employee)?.name} (1244, collected from pay)</td>
                <td className="num">({p(Math.round(Number(charge) * 100))})</td>
              </tr>
            )}
            {Number(sale) > 0 && (
              <tr>
                <td>Received from the sale</td>
                <td className="num">({p(Math.round(Number(sale) * 100))})</td>
              </tr>
            )}
            {f.lossCents > 0 && (
              <tr>
                <td>Loss on disposal (7130)</td>
                <td className="num">{p(f.lossCents)}</td>
              </tr>
            )}
            {f.gainCents > 0 && (
              <tr>
                <td>Gain on sale (7130)</td>
                <td className="num">{p(f.gainCents)}</td>
              </tr>
            )}
            {f.chargeAboveBookCents > 0 && (
              <tr>
                <td>Charge above book value (7150 other income)</td>
                <td className="num">{p(f.chargeAboveBookCents)}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {preview?.errors.length ? <p className="muted">{preview.errors.join(" ")}</p> : null}
      {err && <p className="error">{err}</p>}
      <button disabled={busy || !preview || preview.errors.length > 0} onClick={save}>
        {busy ? "Saving…" : "Retire asset"}
      </button>
    </div>
  );
}

function GoLiveForm({ onDone }: { onDone: () => void }) {
  const accountList = useAccounts();
  const [type, setType] = useState<"asset" | "spread" | "loan">("asset");
  const [v, setV] = useState<Record<string, string>>({ book: "Store", profit_center: "GGC", kind: "Prepaid" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const book = (v.book as Book) ?? "Store";
  const options = (pred: (a: (typeof accountList)[number]) => boolean) =>
    accountList.filter((a) => !a.isHeader && pred(a)).map((a) => (
      <option key={a.code} value={a.code}>
        {a.code} {a.name}
      </option>
    ));
  const fctx = { book, profitCenter: "GGC" as const };
  const text = (k: string, label: string, type = "text") => (
    <label>
      {label}
      <input type={type} step={type === "number" ? "0.01" : undefined} value={v[k] ?? ""} onChange={set(k)} />
    </label>
  );

  function payload(): Record<string, unknown> {
    if (type === "asset") {
      return {
        name: v.name,
        book,
        account_code: v.account_code,
        accum_account_code: ACCUMULATED_DEPRECIATION[v.account_code] ?? "",
        profit_center: v.profit_center,
        cost: Number(v.cost),
        acquired_date: v.acquired_date,
        in_use_date: v.in_use_date,
        useful_life_months: Number(v.life || DEFAULT_LIFE_MONTHS[v.account_code]),
        depreciated_before_go_live: Number(v.depreciated || 0),
      };
    }
    if (type === "spread") {
      return {
        kind: v.kind,
        name: v.name,
        book,
        asset_account: v.asset_account,
        expense_account: v.expense_account,
        profit_center: v.profit_center,
        total: Number(v.total),
        start_month: `${v.start_month}-01`,
        months: Number(v.months),
        amortized_before_go_live: Number(v.amortized || 0),
      };
    }
    // A loan's go-live record: the full straight-line schedule from the first installment, with
    // the installments paid before Nov 1, 2026 marked paid (no entries; they're in the opening balances).
    const schedule = loanSchedule();
    const paidBefore = Number(v.paid_before || 0);
    return {
      name: v.name,
      lender_name: v.lender_name,
      account_code: v.account_code,
      interest_account: v.interest_account,
      book,
      principal: Number(v.principal),
      method: "straight-line",
      installment_amount: Number(v.installment),
      term_months: Number(v.months),
      start_date: v.first_due,
      notes: v.notes || null,
      installments: schedule.installments.map((i) => ({
        seq: i.seq,
        due_date: i.dueDate,
        principal: fromCents(i.principalCents),
        interest: fromCents(i.interestCents),
        paid_before_go_live: i.seq <= paidBefore,
      })),
    };
  }

  function loanSchedule() {
    return buildSchedule({
      principalCents: toCents(Number(v.principal || 0)),
      months: Number(v.months || 0),
      firstDue: v.first_due ?? "",
      installmentCents: toCents(Number(v.installment || 0)),
    });
  }
  const preview = type === "loan" && v.principal && v.installment && v.months && v.first_due ? loanSchedule() : null;
  const paidBefore = Number(v.paid_before || 0);

  async function save() {
    if (preview?.errors.length) return setError(preview.errors[0]);
    setBusy(true);
    setError(null);
    try {
      await api("/registers", { method: "POST", body: JSON.stringify({ type, data: payload() }) });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    }
    setBusy(false);
  }

  return (
    <div className="card grid2">
      <label>
        Record
        <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="asset">Fixed asset</option>
          <option value="spread">Prepaid / deferred charge</option>
          <option value="loan">Loan</option>
        </select>
      </label>
      <label>
        Book
        <select value={book} onChange={set("book")}>
          <option>Store</option>
          <option>Commissary</option>
        </select>
      </label>
      {text("name", "Name")}
      {type !== "loan" && (
        <label>
          Tag
          <select value={v.profit_center} onChange={set("profit_center")}>
            <option>GGC</option>
            <option>The Nest</option>
            <option>Shared</option>
          </select>
        </label>
      )}
      {type === "asset" && (
        <>
          <label>
            Class
            <select value={v.account_code ?? ""} onChange={set("account_code")}>
              <option value="">Choose…</option>
              {options((a) => a.parentCode === "1500" && a.type === "Asset")}
            </select>
          </label>
          {text("cost", "Cost", "number")}
          {text("acquired_date", "Acquired", "date")}
          {text("in_use_date", "Put to use", "date")}
          {text("life", "Useful life (months)", "number")}
          {text("depreciated", "Depreciated up to Oct 31, 2026", "number")}
        </>
      )}
      {type === "spread" && (
        <>
          <label>
            Kind
            <select value={v.kind} onChange={set("kind")}>
              <option>Prepaid</option>
              <option>Deferred charge</option>
            </select>
          </label>
          <label>
            Balance sheet account
            <select value={v.asset_account ?? ""} onChange={set("asset_account")}>
              <option value="">Choose…</option>
              {options((a) => a.statement === "Balance Sheet" && a.type === "Asset" && !a.isCashAccount)}
            </select>
          </label>
          <label>
            Expensed to
            <select value={v.expense_account ?? ""} onChange={set("expense_account")}>
              <option value="">Choose…</option>
              {options((a) => a.statement === "Income Statement")}
            </select>
          </label>
          {text("total", "Total", "number")}
          {text("start_month", "First month", "month")}
          {text("months", "Months", "number")}
          {text("amortized", "Expensed up to Oct 31, 2026", "number")}
        </>
      )}
      {type === "loan" && (
        <>
          {text("lender_name", "Lender")}
          <label>
            Loans Payable account
            <select value={v.account_code ?? ""} onChange={set("account_code")}>
              <option value="">Choose…</option>
              {options((a) => accountMatches("loan", a, fctx))}
            </select>
          </label>
          <label>
            Interest expense account
            <select value={v.interest_account ?? ""} onChange={set("interest_account")}>
              <option value="">Choose…</option>
              {options((a) => accountMatches("interest", a, fctx))}
            </select>
          </label>
          {text("principal", "Original principal", "number")}
          {text("installment", "Monthly installment amount", "number")}
          {text("months", "Number of installments (months)", "number")}
          {text("first_due", "First installment due", "date")}
          {text("paid_before", "Installments paid before Nov 1, 2026", "number")}
          {text("notes", "Notes")}
          {preview && (
            <p className={`span2 ${preview.errors.length ? "error" : "muted"}`}>
              {preview.errors.length
                ? preview.errors.join(" ")
                : `Straight-line: total interest ${formatPeso(preview.totalInterestCents)}; ${formatPeso(preview.principalPerMonthCents)} principal + ${formatPeso(preview.interestPerMonthCents)} interest a month. Opening Loans Payable (Oct 31): ${formatPeso(toCents(Number(v.principal)) - preview.installments.filter((i) => i.seq <= paidBefore).reduce((s, i) => s + i.principalCents, 0))}.`}
            </p>
          )}
        </>
      )}
      {error && <p className="error span2">{error}</p>}
      <button disabled={busy || !v.name} onClick={save}>
        {busy ? "Saving…" : "Save go-live record"}
      </button>
    </div>
  );
}
