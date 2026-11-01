import type { StatementRow } from "../../shared/statements";
import { todayManila, useLoad } from "../lib/data";
import { useParam } from "./Ledger";
import { amount, pct, StatementView } from "./Statements";

interface Report {
  period: string;
  label: string;
  asOf: string;
  status: "Final" | "Preliminary";
  summary: string[];
  income: { columns: { key: string; label: string }[]; rows: StatementRow[] };
  balance: { columns: { key: string; label: string }[]; rows: StatementRow[] };
  cashFlow: { openingCents: number; closingCents: number; lines: { activity: string; label: string; cents: number }[] };
  cogs: { label: string; total: boolean; monthCents: number; monthPct: number; r3Cents: number; r3Pct: number }[];
  loans: { name: string; lender: string; rate: number; principalCents: number; interestPayableCents: number; paid: number; of: number; next: { dueDate: string; cents: number } | null; overdue: number }[];
  ratios: {
    month: Record<string, number>;
    r3: Record<string, number>;
    debtServicePct: number;
    runwayWeeks: number | null;
  };
  judgment: { date: string; category: string; description: string; decidedBy: string }[];
  redFlags: string[];
  openItems: string[];
}

const lastMonth = () => {
  const [y, m] = todayManila().split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
};

/** The monthly management report: one printable page per section. */
export default function ManagementReport() {
  const [period, setPeriod] = useParam("period", lastMonth());
  const { data, error } = useLoad<Report>(`/reports/management?period=${period}`);
  const ratioRows: [string, string][] = [
    ["COGS %", "cogsPct"],
    ["Labor %", "laborPct"],
    ["Utilities %", "utilitiesPct"],
    ["Marketing %", "marketingPct"],
    ["Net margin", "netMarginPct"],
  ];

  return (
    <section className="report">
      <div className="page-head no-print">
        <h1>Management report</h1>
        <input type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
        <button className="secondary" disabled={!data} onClick={() => window.print()}>
          Print / PDF
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Putting the report together…</p>}
      {data && (
        <>
          <div className="stmt">
            <div className="stmt-head">
              <div className="co">Quintet Allied Services &amp; Ventures Corp.</div>
              <div>Go Go Chicken · The Nest</div>
              <div className="t">Management Report – {data.label}</div>
              <div className="muted">
                As of {data.asOf} <span className={`badge ${data.status === "Final" ? "ok" : "info"}`}>{data.status}</span>
              </div>
            </div>
            <h2>1. Summary</h2>
            <ol className="summary">
              {data.summary.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>

          <h2 className="report-h">2. Statements</h2>
          <StatementView
            data={{ title: "Income Statement", subtitle: `For the month ended ${data.asOf}`, status: data.status, columns: data.income.columns, rows: data.income.rows }}
            note="GGC (Store and Commissary) and The Nest"
          />
          <StatementView data={{ title: "Balance Sheet", subtitle: `As of ${data.asOf}`, status: data.status, columns: data.balance.columns, rows: data.balance.rows }} note="Whole business" />
          <div className="stmt">
            <h2>Cash flow – {data.label}</h2>
            <table className="stmt-table">
              <tbody>
                <tr className="s-line">
                  <td>Cash at the beginning of the month</td>
                  <td className="num">{amount(data.cashFlow.openingCents)}</td>
                </tr>
                {data.cashFlow.lines.map((l) => (
                  <tr key={l.label} className="s-line">
                    <td>
                      {l.label} <span className="muted">· {l.activity}</span>
                    </td>
                    <td className="num">{amount(l.cents)}</td>
                  </tr>
                ))}
                <tr className="s-grand">
                  <td>Cash at the end of the month</td>
                  <td className="num">{amount(data.cashFlow.closingCents)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="stmt">
            <h2>3. Cost of goods sold per ingredient</h2>
            <p className="muted">Ingredients are expensed when bought, so one month swings with purchase timing; read the rolling 3 months for the trend.</p>
            <table className="stmt-table">
              <thead>
                <tr>
                  <th>Whole business</th>
                  <th className="num">{data.label}</th>
                  <th className="num">% of sales</th>
                  <th className="num">Rolling 3 months</th>
                  <th className="num">% of sales</th>
                </tr>
              </thead>
              <tbody>
                {data.cogs.map((r) => (
                  <tr key={r.label} className={r.total ? "s-total" : "s-line"}>
                    <td>{r.label}</td>
                    <td className="num">{amount(r.monthCents)}</td>
                    <td className="num">{pct(r.monthPct)}</td>
                    <td className="num">{amount(r.r3Cents)}</td>
                    <td className="num">{pct(r.r3Pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="stmt">
            <h2>4. Loans</h2>
            <table className="stmt-table">
              <thead>
                <tr>
                  <th>Loan</th>
                  <th className="num">Rate</th>
                  <th className="num">Principal owed</th>
                  <th className="num">Interest payable</th>
                  <th className="num">Paid</th>
                  <th>Next installment</th>
                </tr>
              </thead>
              <tbody>
                {data.loans.map((l) => (
                  <tr key={l.name} className="s-line">
                    <td>
                      {l.name}
                      {l.lender && <span className="muted"> · {l.lender}</span>}
                      {l.overdue > 0 && <span className="badge error">{l.overdue} overdue</span>}
                    </td>
                    <td className="num">{l.rate.toFixed(2)}%</td>
                    <td className="num">{amount(l.principalCents)}</td>
                    <td className="num">{amount(l.interestPayableCents)}</td>
                    <td className="num">
                      {l.paid} of {l.of}
                    </td>
                    <td>{l.next ? `${l.next.dueDate} · ${amount(l.next.cents)}` : "Fully paid"}</td>
                  </tr>
                ))}
                {!data.loans.length && (
                  <tr>
                    <td className="muted" colSpan={6}>
                      No loans.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="stmt">
            <h2>5. Key ratios</h2>
            <table className="stmt-table">
              <thead>
                <tr>
                  <th />
                  <th className="num">{data.label}</th>
                  <th className="num">Rolling 3 months</th>
                </tr>
              </thead>
              <tbody>
                <tr className="s-line">
                  <td>Net sales</td>
                  <td className="num">{amount(data.ratios.month.netSalesCents)}</td>
                  <td className="num">{amount(data.ratios.r3.netSalesCents)}</td>
                </tr>
                {ratioRows.map(([label, key]) => (
                  <tr key={key} className="s-line">
                    <td>{label}</td>
                    <td className="num">{pct(data.ratios.month[key])}</td>
                    <td className="num">{pct(data.ratios.r3[key])}</td>
                  </tr>
                ))}
                <tr className="s-line">
                  <td>Debt service (principal + interest paid) % of sales</td>
                  <td className="num">{pct(data.ratios.debtServicePct)}</td>
                  <td />
                </tr>
                <tr className="s-line">
                  <td>Cash runway (weeks of operating spending, at the 3-month average)</td>
                  <td className="num">{data.ratios.runwayWeeks ?? "–"}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>

          <div className="stmt">
            <h2>6. Adjustments &amp; Judgment Log</h2>
            {data.judgment.length ? (
              <table className="stmt-table">
                <tbody>
                  {data.judgment.map((j, i) => (
                    <tr key={i} className="s-line">
                      <td>{j.date}</td>
                      <td>{j.category}</td>
                      <td className="wrap">{j.description}</td>
                      <td>{j.decidedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">No judgment calls logged this month.</p>
            )}
          </div>

          <div className="stmt">
            <h2>7. Red flags and decisions needed</h2>
            {data.redFlags.length ? (
              <ul>
                {data.redFlags.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">None.</p>
            )}
            <h2>8. Open items</h2>
            {data.openItems.length ? (
              <ul>
                {data.openItems.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">None.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
