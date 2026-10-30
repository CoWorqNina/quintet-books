import { useState } from "react";
import { ACCUMULATED_DEPRECIATION, accountMatches, DEFAULT_LIFE_MONTHS } from "../../shared/accounts";
import { buildSchedule } from "../../shared/loans";
import { formatPeso, fromCents, toCents } from "../../shared/money";
import type { AppUser, Book } from "../../shared/types";
import { api } from "../lib/api";
import { useAccounts, useLoad } from "../lib/data";

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
  popup: boolean;
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
}
interface Loan extends Status {
  id: number;
  name: string;
  lender_name: string;
  account_code: string;
  principal: number;
  annual_rate: number;
  term_months: number;
  installments: { id: number; seq: number; due_date: string; principal: number; interest: number; paid_entry_id: number | null }[] | null;
}

const peso = (n: number) => formatPeso(toCents(n));

function StatusBadge({ r }: { r: Status }) {
  if (!r.entry_id) return <span className="badge">Go-live</span>;
  if (!r.in_force) return <span className="badge muted-badge">Reversed / cancelled</span>;
  return <span className={`badge ${r.entry_status === "Approved" ? "ok" : "info"}`}>{r.entry_status}</span>;
}

/** Fixed Asset Register, prepaid and deferred spreads, and the Loan Tracker. */
export default function Registers({ user }: { user: AppUser }) {
  const { data, error, reload } = useLoad<{ assets: Asset[]; spreads: Spread[]; loans: Loan[] }>("/registers");
  const [adding, setAdding] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const live = <T extends Status>(rows: T[] = []) => (showAll ? rows : rows.filter((r) => r.in_force));

  return (
    <section>
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
              <th>Cost</th>
              <th>In use</th>
              <th>Life</th>
              <th>Depreciated before go-live</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {live(data?.assets).map((a) => (
              <tr key={a.id}>
                <td>
                  {a.name}
                  {a.popup && <span className="muted"> · pop-ups</span>}
                </td>
                <td>{a.account_code}</td>
                <td>{a.profit_center}</td>
                <td className="num">{peso(a.cost)}</td>
                <td>{a.in_use_date}</td>
                <td>{a.useful_life_months} mo</td>
                <td className="num">{peso(a.depreciated_before_go_live)}</td>
                <td>
                  <StatusBadge r={a} />
                </td>
              </tr>
            ))}
          </tbody>
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
              <th>Total</th>
              <th>From</th>
              <th>Months</th>
              <th>Amortized before go-live</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {live(data?.spreads).map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.kind}</td>
                <td>
                  {s.asset_account} → {s.expense_account}
                </td>
                <td>{s.profit_center}</td>
                <td className="num">{peso(s.total)}</td>
                <td>{s.start_month.slice(0, 7)}</td>
                <td>{s.months}</td>
                <td className="num">{peso(s.amortized_before_go_live)}</td>
                <td>
                  <StatusBadge r={s} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Loans</h2>
      {live(data?.loans).map((l) => {
        const inst = l.installments ?? [];
        const paid = inst.filter((i) => i.paid_entry_id);
        const balance = l.principal - paid.reduce((s, i) => s + Number(i.principal), 0);
        return (
          <details key={l.id} className="card">
            <summary>
              <strong>{l.name}</strong> · {l.lender_name} · {l.account_code} · {peso(l.principal)} at {l.annual_rate}% · {paid.length}/{inst.length}{" "}
              paid · balance {peso(balance)} <StatusBadge r={l} />
            </summary>
            <table className="lines">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Due</th>
                  <th>Principal</th>
                  <th>Interest</th>
                  <th>Paid</th>
                </tr>
              </thead>
              <tbody>
                {inst.map((i) => (
                  <tr key={i.id}>
                    <td>{i.seq}</td>
                    <td>{i.due_date}</td>
                    <td className="num">{peso(i.principal)}</td>
                    <td className="num">{peso(i.interest)}</td>
                    <td>{i.paid_entry_id ? `entry #${i.paid_entry_id}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        );
      })}
    </section>
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
    // A loan's go-live record carries the balance on Oct 31 and the installments still to pay.
    const schedule = buildSchedule({
      principalCents: toCents(Number(v.balance)),
      months: Number(v.months),
      firstDue: v.first_due,
      installmentCents: v.installment ? toCents(Number(v.installment)) : undefined,
      annualRatePct: v.installment ? undefined : Number(v.rate || 0),
    });
    return {
      name: v.name,
      lender_name: v.lender_name,
      account_code: v.account_code,
      interest_account: v.interest_account,
      book,
      principal: Number(v.balance),
      annual_rate: schedule.annualRatePct,
      term_months: Number(v.months),
      start_date: "2026-10-31",
      informal: !v.installment,
      notes: v.notes || null,
      installments: schedule.installments.map((i) => ({ seq: i.seq, due_date: i.dueDate, principal: fromCents(i.principalCents), interest: fromCents(i.interestCents) })),
    };
  }

  async function save() {
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
          {text("balance", "Principal balance on Oct 31, 2026", "number")}
          {text("months", "Installments left", "number")}
          {text("first_due", "Next installment due", "date")}
          {text("installment", "Monthly installment (lender loans)", "number")}
          {text("rate", "Or annual rate % (informal loans)", "number")}
          {text("notes", "Notes (original amount, terms)")}
        </>
      )}
      {error && <p className="error span2">{error}</p>}
      <button disabled={busy || !v.name} onClick={save}>
        {busy ? "Saving…" : "Save go-live record"}
      </button>
    </div>
  );
}
