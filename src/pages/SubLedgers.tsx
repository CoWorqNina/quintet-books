import { Fragment, useMemo } from "react";
import { Link } from "react-router-dom";
import { INGREDIENT_ACCOUNTS } from "../../shared/ledger";
import { formatPeso, toCents } from "../../shared/money";
import { todayManila, useLoad } from "../lib/data";
import { BookSelect, peso, useParam } from "./Ledger";

interface OpenItem {
  entryId: number;
  date: string;
  description: string | null;
  openCents: number;
  ageDays: number;
}

const KINDS = [
  { key: "ap", label: "Accounts payable" },
  { key: "employees", label: "Employee receivables" },
  { key: "loans", label: "Loans & interest payable" },
  { key: "owners", label: "Owners: loans, advances, food allowance" },
  { key: "reimbursements", label: "Reimbursements" },
  { key: "clearing", label: "Card / Grab / Foodpanda" },
];

export function SubLedgers() {
  const [kind, setKind] = useParam("kind", "ap");
  const [asOf, setAsOf] = useParam("asOf", todayManila());
  const [book, setBook] = useParam("book", "Combined");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = useLoad<any>(`/ledger/sub/${kind}?asOf=${asOf}&book=${book}`);
  const ready = data && data.asOf === asOf;

  return (
    <>
      <div className="page-head">
        <h1>Sub-ledgers</h1>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </select>
        <span className="muted">as of</span>
        <input type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} />
        <BookSelect value={book} onChange={setBook} />
      </div>
      {error && <p className="error">{error}</p>}
      {ready && kind === "ap" && "parties" in data && <Payables data={data} />}
      {ready && kind === "employees" && "people" in data && "accounts" in data && <Employees data={data} />}
      {ready && kind === "loans" && "interestControlCents" in data && <Loans data={data} />}
      {ready && kind === "owners" && "advances" in data && <Owners data={data} />}
      {ready && kind === "reimbursements" && "people" in data && !("accounts" in data) && <Reimbursements data={data} />}
      {ready && kind === "clearing" && "accounts" in data && "buckets" in data && <Clearing data={data} />}
    </>
  );
}

function Items({ items, colSpan, limit }: { items: OpenItem[]; colSpan: number; limit?: number }) {
  return (
    <tr>
      <td colSpan={colSpan}>
        <table className="lines">
          <tbody>
            {items.map((i) => (
              <tr key={i.entryId}>
                <td>
                  {i.date} · <Link to={`/journal?entry=${i.entryId}`}>#{i.entryId}</Link> {i.description}
                </td>
                <td className={limit !== undefined && i.ageDays > limit ? "error" : "muted"}>{i.ageDays} days</td>
                <td className="num">{peso(i.openCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </td>
    </tr>
  );
}

function ControlCheck({ controlCents, totalCents }: { controlCents: number; totalCents: number }) {
  const ok = controlCents === totalCents;
  return (
    <p>
      <span className={`badge ${ok ? "ok" : "error"}`}>{ok ? "Agrees with the ledger" : "Does not agree with the ledger"}</span>{" "}
      <span className="muted">Ledger balance {peso(controlCents)}</span>
    </p>
  );
}

function Payables({ data }: { data: { buckets: string[]; controlCents: number; parties: { party: string; balanceCents: number; buckets: number[]; items: OpenItem[] }[] } }) {
  const total = data.parties.reduce((s, p) => s + p.balanceCents, 0);
  return (
    <>
      <ControlCheck controlCents={data.controlCents} totalCents={total} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Supplier</th>
              {data.buckets.map((b) => (
                <th key={b} className="num">
                  {b}
                </th>
              ))}
              <th className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            {data.parties.map((p) => (
              <Fragment key={p.party}>
                <tr className="header-row">
                  <td>{p.party}</td>
                  {p.buckets.map((b, i) => (
                    <td key={i} className="num">
                      {b ? peso(b) : ""}
                    </td>
                  ))}
                  <td className="num">{peso(p.balanceCents)}</td>
                </tr>
                <Items items={p.items} colSpan={data.buckets.length + 2} />
              </Fragment>
            ))}
            {!data.parties.length && (
              <tr>
                <td className="muted" colSpan={data.buckets.length + 2}>
                  Nothing owed to suppliers.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="header-row">
              <td>Total</td>
              {data.buckets.map((_, i) => (
                <td key={i} className="num">
                  {peso(data.parties.reduce((s, p) => s + p.buckets[i], 0))}
                </td>
              ))}
              <td className="num">{peso(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

function Employees({ data }: { data: { controlCents: number; accounts: { code: string; name: string }[]; people: { party: string; byAccount: Record<string, number>; balanceCents: number }[] } }) {
  const total = data.people.reduce((s, p) => s + p.balanceCents, 0);
  const short = (n: string) => n.replace(/^Receivable from Employees – /, "");
  return (
    <>
      <ControlCheck controlCents={data.controlCents} totalCents={total} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              {data.accounts.map((a) => (
                <th key={a.code} className="num">
                  {short(a.name)}
                </th>
              ))}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.people.map((p) => (
              <tr key={p.party}>
                <td>{p.party}</td>
                {data.accounts.map((a) => (
                  <td key={a.code} className="num">
                    {p.byAccount[a.code] ? peso(p.byAccount[a.code]) : ""}
                  </td>
                ))}
                <td className="num">{peso(p.balanceCents)}</td>
              </tr>
            ))}
            {!data.people.length && (
              <tr>
                <td className="muted" colSpan={data.accounts.length + 2}>
                  No employee balances.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="header-row">
              <td>Total</td>
              {data.accounts.map((a) => (
                <td key={a.code} className="num">
                  {peso(data.people.reduce((s, p) => s + (p.byAccount[a.code] ?? 0), 0))}
                </td>
              ))}
              <td className="num">{peso(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

function PartyTable({ title, rows, empty }: { title: string; rows: { party: string; balanceCents: number }[]; empty: string }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      <table>
        <tbody>
          {rows.map((r) => (
            <tr key={r.party}>
              <td>{r.party}</td>
              <td className="num">{peso(r.balanceCents)}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td className="muted">{empty}</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="header-row">
            <td>Total</td>
            <td className="num">{peso(rows.reduce((s, r) => s + r.balanceCents, 0))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

interface LoanRow {
  id: number;
  name: string;
  lender: string;
  accountCode: string;
  principalCents: number;
  trackerCents: number;
  interestPayableCents: number;
  approved: boolean;
}

function Loans({ data }: { data: { loans: LoanRow[]; untaggedInterestCents: number; untaggedEntries: number[]; interestControlCents: number } }) {
  const totalPrincipal = data.loans.reduce((s, l) => s + l.principalCents, 0);
  const totalInterest = data.loans.reduce((s, l) => s + l.interestPayableCents, 0) + data.untaggedInterestCents;
  return (
    <>
      <p className="muted">
        Principal stays in each loan's own Loans Payable account. Interest owed but not yet paid sits in 2250 Accrued Interest Payable, tagged to
        its loan, and is cleared when the installment is paid.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Loan</th>
              <th>Account</th>
              <th className="num">Principal owed</th>
              <th className="num">Loan Tracker</th>
              <th className="num">Interest payable</th>
              <th className="num">Total owed</th>
            </tr>
          </thead>
          <tbody>
            {data.loans.map((l) => (
              <tr key={l.id}>
                <td>
                  {l.name}
                  {l.lender && <span className="muted"> · {l.lender}</span>}
                  {!l.approved && <span className="badge info">Waiting for approval</span>}
                </td>
                <td>{l.accountCode}</td>
                <td className="num">{peso(l.principalCents)}</td>
                <td className={`num ${l.trackerCents !== l.principalCents ? "error" : "muted"}`}>{peso(l.trackerCents)}</td>
                <td className="num">{peso(l.interestPayableCents)}</td>
                <td className="num">{peso(l.principalCents + l.interestPayableCents)}</td>
              </tr>
            ))}
            {data.untaggedInterestCents !== 0 && (
              <tr>
                <td colSpan={4} className="error">
                  Interest not tagged to a loan (entries {data.untaggedEntries.map((id) => `#${id}`).join(", ")}): correct these entries
                </td>
                <td className="num error">{peso(data.untaggedInterestCents)}</td>
                <td />
              </tr>
            )}
            {!data.loans.length && (
              <tr>
                <td colSpan={6} className="muted">
                  No loans yet. Loans come from #33 Loan Proceeds or Registers → Add go-live record.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="header-row">
              <td colSpan={2}>Total</td>
              <td className="num">{peso(totalPrincipal)}</td>
              <td />
              <td className="num">{peso(totalInterest)}</td>
              <td className="num">{peso(totalPrincipal + totalInterest)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <ControlCheck controlCents={data.interestControlCents} totalCents={totalInterest - data.untaggedInterestCents} />
    </>
  );
}

export interface AllowanceRow {
  owner: string;
  takenCents: number;
  allowanceCents: number;
  chargedBackCents: number;
  stillAboveCents: number;
  owedCents: number;
}

/** Owner's food allowance for one month: taken, allowance, charged back, still to charge, and what each owner owes. */
export function AllowanceTable({ rows, month }: { rows: AllowanceRow[]; month: string }) {
  return (
    <div className="card">
      <h2>Owner's food allowance – {month}</h2>
      <p className="muted">
        Food at menu price, from the daily reports. Anything above the allowance is charged back at month-end (Month-end → Adjusting entries)
        and paid back with #38.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Owner</th>
              <th className="num">Food taken</th>
              <th className="num">Allowance</th>
              <th className="num">Above allowance</th>
              <th className="num">Charged back</th>
              <th className="num">Owed to GGC (all months)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.owner}>
                <td>{r.owner}</td>
                <td className="num">{peso(r.takenCents)}</td>
                <td className="num">{peso(r.allowanceCents)}</td>
                <td className={`num ${r.takenCents > r.allowanceCents ? "error" : ""}`}>{peso(Math.max(0, r.takenCents - r.allowanceCents))}</td>
                <td className="num">
                  {peso(r.chargedBackCents)}
                  {r.stillAboveCents > 0 && <span className="badge warn">{peso(r.stillAboveCents)} still to charge</span>}
                </td>
                <td className="num">{peso(r.owedCents)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td className="muted" colSpan={6}>
                  No owner food charged this month.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Owners({ data }: { data: { month: string; loans: { party: string; balanceCents: number }[]; advances: { party: string; balanceCents: number }[]; allowance: AllowanceRow[] } }) {
  return (
    <>
      <AllowanceTable rows={data.allowance} month={data.month} />
      <p className="muted">Shown separately and never netted: loans are what the business owes each owner; advances are what each owner owes the business.</p>
      <div className="grid2">
        <PartyTable title="Loans from owners (2260)" rows={data.loans} empty="No owner loans." />
        <PartyTable title="Advances to owners (1250)" rows={data.advances} empty="No owner advances." />
      </div>
    </>
  );
}

function Reimbursements({ data }: { data: { people: { code: string; name: string; balanceCents: number }[] } }) {
  return <PartyTable title="Reimbursements payable" rows={data.people.map((p) => ({ party: `${p.code} ${p.name.replace(/^Reimbursements Payable – /, "")}`, balanceCents: p.balanceCents }))} empty="" />;
}

function Clearing({ data }: { data: { buckets: string[]; accounts: { code: string; name: string; limitDays: number; balanceCents: number; buckets: number[]; overdue: OpenItem[]; items: OpenItem[] }[] } }) {
  return (
    <>
      <p className="muted">Sales waiting for the bank. Card payouts should arrive within 10 days, Grab and Foodpanda within 14.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Account</th>
              {data.buckets.map((b) => (
                <th key={b} className="num">
                  {b}
                </th>
              ))}
              <th className="num">Unpaid</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.accounts.map((a) => (
              <Fragment key={a.code}>
                <tr className="header-row">
                  <td>
                    {a.code} {a.name.replace(" Due for Transfer", "")}
                  </td>
                  {a.buckets.map((b, i) => (
                    <td key={i} className="num">
                      {b ? peso(b) : ""}
                    </td>
                  ))}
                  <td className="num">{peso(a.balanceCents)}</td>
                  <td>{a.overdue.length ? <span className="badge error">{a.overdue.length} over {a.limitDays} days</span> : a.balanceCents ? <span className="badge ok">On time</span> : null}</td>
                </tr>
                {a.items.length > 0 && <Items items={a.items} colSpan={data.buckets.length + 3} limit={a.limitDays} />}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

interface CostLine {
  entry_id: number;
  entry_date: string;
  account_code: string;
  supplier: string | null;
  quantity: number;
  unit: string | null;
  unit_price: number;
  amount: number;
}

export function SupplierCosts() {
  const today = todayManila();
  const [from, setFrom] = useParam("from", `${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useParam("to", today);
  const [code, setCode] = useParam("ingredient", INGREDIENT_ACCOUNTS[0]);
  const { data, error } = useLoad<{ ingredients: { code: string; name: string }[]; lines: CostLine[] }>(`/ledger/costs?from=${from}&to=${to}`);
  const lines = useMemo(() => (data?.lines ?? []).filter((l) => l.account_code === code), [data, code]);
  const bySupplier = useMemo(() => {
    const m = new Map<string, { qty: Map<string, number>; amount: Map<string, number>; last: CostLine }>();
    for (const l of lines) {
      const key = l.supplier ?? "(no supplier)";
      const s = m.get(key) ?? { qty: new Map(), amount: new Map(), last: l };
      const unit = l.unit ?? "";
      s.qty.set(unit, (s.qty.get(unit) ?? 0) + Number(l.quantity));
      s.amount.set(unit, (s.amount.get(unit) ?? 0) + toCents(Number(l.amount)));
      s.last = l;
      m.set(key, s);
    }
    return [...m.entries()];
  }, [lines]);

  return (
    <>
      <div className="page-head">
        <h1>Supplier costs</h1>
        <select value={code} onChange={(e) => setCode(e.target.value)}>
          {(data?.ingredients ?? INGREDIENT_ACCOUNTS.map((c) => ({ code: c, name: c }))).map((i) => (
            <option key={i.code} value={i.code}>
              {i.code} {i.name}
            </option>
          ))}
        </select>
        <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        <span className="muted">to</span>
        <input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
      </div>
      {error && <p className="error">{error}</p>}
      <h2>By supplier</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Unit</th>
              <th className="num">Quantity</th>
              <th className="num">Average price</th>
              <th className="num">Last price</th>
              <th>Last bought</th>
            </tr>
          </thead>
          <tbody>
            {bySupplier.flatMap(([supplier, s]) =>
              [...s.qty.entries()].map(([unit, qty]) => (
                <tr key={supplier + unit}>
                  <td>{supplier}</td>
                  <td>{unit}</td>
                  <td className="num">{qty.toLocaleString("en-PH")}</td>
                  <td className="num">{formatPeso(Math.round((s.amount.get(unit) ?? 0) / qty))}</td>
                  <td className="num">{s.last.unit === unit ? formatPeso(toCents(Number(s.last.unit_price))) : ""}</td>
                  <td>{s.last.entry_date}</td>
                </tr>
              )),
            )}
            {!bySupplier.length && (
              <tr>
                <td colSpan={6} className="muted">
                  No purchases with quantities in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <h2>Every purchase</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Entry</th>
              <th>Supplier</th>
              <th className="num">Quantity</th>
              <th className="num">Unit price</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={`${l.entry_id}-${l.amount}-${l.quantity}`}>
                <td>{l.entry_date}</td>
                <td>
                  <Link to={`/journal?entry=${l.entry_id}`}>#{l.entry_id}</Link>
                </td>
                <td>{l.supplier ?? ""}</td>
                <td className="num">
                  {Number(l.quantity).toLocaleString("en-PH")} {l.unit}
                </td>
                <td className="num">{formatPeso(toCents(Number(l.unit_price)))}</td>
                <td className="num">{formatPeso(toCents(Number(l.amount)))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
