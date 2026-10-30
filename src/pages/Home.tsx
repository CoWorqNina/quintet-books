import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DAILY_REPORT_ROLES } from "../../shared/templates";
import type { AppUser, JournalEntry, Period } from "../../shared/types";
import { api } from "../lib/api";
import { supabase } from "../lib/supabase";

export default function Home({ user }: { user: AppUser }) {
  const [periods, setPeriods] = useState<Period[] | null>(null);
  const [waiting, setWaiting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const owner = user.role === "Owner";

  useEffect(() => {
    api<Period[]>("/periods")
      .then(setPeriods)
      .catch((e: Error) => setError(e.message));
    if (owner) api<JournalEntry[]>("/entries/approvals").then((list) => setWaiting(list.length)).catch(() => {});
  }, [owner]);

  async function downloadBackup() {
    const { data } = await supabase.auth.getSession();
    const res = await fetch("/api/backup", { headers: { Authorization: `Bearer ${data.session?.access_token}` } });
    if (!res.ok) return alert("Backup failed");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "ggc-books-ledger.json.gz";
    a.click();
    URL.revokeObjectURL(url);
  }

  const open = periods?.filter((p) => p.status === "Open" && p.key >= "2026-11").slice(0, 2);

  return (
    <section>
      <h1>Welcome, {user.fullName}</h1>
      <p className="muted">
        {user.role} · Books: {user.books.join(", ")} · Profit centers: {user.profitCenters.join(", ")}
      </p>
      <div className="tiles">
        {DAILY_REPORT_ROLES.includes(user.role) && (
          <Link className="tile" to="/daily-reports/new">
            <strong>Encode today's cashier report</strong>
            <span className="muted">POS slips + handwritten cash report</span>
          </Link>
        )}
        {owner && (
          <Link className="tile" to="/approvals">
            <strong>Approvals</strong>
            <span className="muted">{waiting === null ? "…" : `${waiting} waiting`}</span>
          </Link>
        )}
        <Link className="tile" to="/journal">
          <strong>Journal</strong>
          <span className="muted">All entries and their status</span>
        </Link>
      </div>
      <div className="card">
        <h2>Open months</h2>
        {error && <p className="error">{error}</p>}
        {open && (
          <ul>
            {open.map((p) => (
              <li key={p.key}>
                {p.key} <span className="muted">(statements Preliminary until closed)</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {owner && (
        <div className="card">
          <h2>Backup</h2>
          <p className="muted">The ledger is backed up every night at 2 AM. You can also download a copy now.</p>
          <button className="secondary" onClick={downloadBackup}>
            Download ledger backup
          </button>
        </div>
      )}
    </section>
  );
}
