import { useEffect, useState } from "react";
import type { AppUser, Period } from "../../shared/types";
import { api } from "../lib/api";

export default function Home({ user }: { user: AppUser }) {
  const [periods, setPeriods] = useState<Period[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Period[]>("/periods")
      .then(setPeriods)
      .catch((e: Error) => setError(e.message));
  }, []);

  const open = periods?.filter((p) => p.status === "Open").slice(0, 3);

  return (
    <section>
      <h1>Welcome, {user.fullName}</h1>
      <p className="muted">
        Books: {user.books.join(", ")} · Profit centers: {user.profitCenters.join(", ")}
      </p>
      <div className="card">
        <h2>Open months</h2>
        {error && <p className="error">{error}</p>}
        {!periods && !error && <p className="muted">Loading…</p>}
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
      <p className="muted">Daily entry, approvals and reports arrive in Phase 1.</p>
    </section>
  );
}
