import { useState } from "react";
import { Link } from "react-router-dom";
import { formatPeso, toCents } from "../../shared/money";
import type { DailyReportSummary } from "../../shared/types";
import { AttachmentLinks } from "../components/inputs";
import { api } from "../lib/api";
import { todayManila, useLoad } from "../lib/data";

export default function DailyReports() {
  const [month, setMonth] = useState(todayManila().slice(0, 7));
  const { data, error, reload } = useLoad<DailyReportSummary[]>(`/daily-reports?month=${month}`);

  async function cancel(r: DailyReportSummary) {
    const reason = prompt(`Cancel the ${r.profitCenter} report for ${r.businessDate}? You can then enter it again.\n\nReason:`);
    if (!reason) return;
    try {
      await api(`/daily-reports/${r.id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not cancel");
    }
  }

  return (
    <section>
      <div className="page-head">
        <h1>Daily reports</h1>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <Link className="button" to="/daily-reports/new">
          + New daily report
        </Link>
      </div>
      {error && <p className="error">{error}</p>}
      {data && !data.length && <p className="muted">No daily reports this month.</p>}
      {data && data.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Profit center</th>
                <th className="num">Net sales</th>
                <th>Entries</th>
                <th>Encoded by</th>
                <th>Photos</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} className={r.status === "Cancelled" ? "inactive" : ""}>
                  <td>
                    <Link to={`/journal?dailyReport=${r.id}`}>{r.businessDate}</Link>
                  </td>
                  <td>{r.profitCenter}</td>
                  <td className="num">{formatPeso(toCents(r.netSales))}</td>
                  <td>
                    {r.status === "Cancelled"
                      ? "Cancelled"
                      : Object.entries(r.entryStatuses)
                          .map(([s, n]) => `${n} ${s}`)
                          .join(", ")}
                  </td>
                  <td>{r.createdBy}</td>
                  <td>
                    <AttachmentLinks items={r.attachments} />
                  </td>
                  <td>
                    {r.status === "Active" && !r.entryStatuses.Approved && (
                      <button className="link danger" onClick={() => cancel(r)}>
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
