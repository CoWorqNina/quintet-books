import { Link, useSearchParams } from "react-router-dom";
import type { AppUser, JournalEntry } from "../../shared/types";
import { EntryCard } from "../components/EntryCard";
import { api } from "../lib/api";
import { todayManila, useLoad } from "../lib/data";

const STATUSES = ["", "Submitted", "Approved", "Rejected", "Cancelled"];

export default function Journal({ user }: { user: AppUser }) {
  const [params, setParams] = useSearchParams();
  const dailyReport = params.get("dailyReport");
  const entry = params.get("entry");
  const period = params.get("period") ?? (dailyReport || entry ? "" : todayManila().slice(0, 7));
  const status = params.get("status") ?? "";
  const query = new URLSearchParams();
  if (period) query.set("period", period);
  if (status) query.set("status", status);
  if (dailyReport) query.set("dailyReport", dailyReport);
  if (entry) query.set("entry", entry);
  const { data, error, reload } = useLoad<JournalEntry[]>(`/entries?${query}`);

  const update = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete("dailyReport");
    next.delete("entry");
    setParams(next);
  };

  async function cancel(e: JournalEntry) {
    if (!confirm(`Cancel entry #${e.id}? It stays in the journal as Cancelled.`)) return;
    try {
      await api(`/entries/${e.id}/cancel`, { method: "POST" });
      reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not cancel");
    }
  }

  async function reverse(e: JournalEntry) {
    const reason = prompt(`Reverse entry #${e.id}? The reversal goes to an Owner for approval.\n\nReason:`);
    if (!reason?.trim()) return;
    try {
      await api(`/entries/${e.id}/reverse`, { method: "POST", body: JSON.stringify({ reason }) });
      reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not reverse");
    }
  }

  const canReverse = (e: JournalEntry) => (user.role === "Owner" || user.role === "Accountant") && e.status === "Approved" && !e.reversedBy;

  // The server checks who may cancel; Staff only ever see their own entries.
  const canCancel = (e: JournalEntry) =>
    !e.dailyReportId && ["Draft", "Submitted", "Rejected"].includes(e.status) && user.role !== "Commissary In-charge";

  return (
    <section>
      <div className="page-head">
        <h1>Journal</h1>
        <input type="month" value={period} onChange={(e) => update("period", e.target.value)} />
        <select value={status} onChange={(e) => update("status", e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s || "All statuses"}
            </option>
          ))}
        </select>
        {dailyReport && <span className="badge info">Daily report {dailyReport}</span>}
        {entry && <span className="badge info">Entry #{entry} and its reversal / classification</span>}
      </div>
      <p className="muted">Only Approved entries count in the ledger and statements.</p>
      {error && <p className="error">{error}</p>}
      {data && !data.length && <p className="muted">No entries.</p>}
      {data?.map((e) => (
        <EntryCard
          key={e.id}
          entry={e}
          actions={
            <>
              {e.reversesEntryId && <span className="muted">Reverses #{e.reversesEntryId}</span>}
              {e.classifiesEntryId && <span className="muted">Classifies #{e.classifiesEntryId}</span>}
              {e.reversedBy && <span className="badge muted-badge">Reversed by #{e.reversedBy}</span>}
              {canReverse(e) && e.correctable && <Link to={`/entries/${e.id}/correct`}>Correct</Link>}
              {canReverse(e) && (
                <button className="link" onClick={() => reverse(e)}>
                  Reverse
                </button>
              )}
              {canCancel(e) && (
                <button className="link danger" onClick={() => cancel(e)}>
                  Cancel
                </button>
              )}
            </>
          }
        />
      ))}
    </section>
  );
}
