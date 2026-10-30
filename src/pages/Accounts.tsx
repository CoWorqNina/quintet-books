import { useEffect, useMemo, useState } from "react";
import type { Account } from "../../shared/types";
import { api } from "../lib/api";

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    api<Account[]>("/accounts")
      .then(setAccounts)
      .catch((e: Error) => setError(e.message));
  }, []);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!accounts || !q) return accounts;
    return accounts.filter((a) => a.code.includes(q) || a.name.toLowerCase().includes(q));
  }, [accounts, filter]);

  return (
    <section>
      <h1>Chart of Accounts</h1>
      <input placeholder="Search code or name" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {error && <p className="error">{error}</p>}
      {!accounts && !error && <p className="muted">Loading…</p>}
      {shown && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Type</th>
                <th>Book</th>
                <th>Profit center</th>
                <th>Sub-ledger</th>
                <th>Cash flow</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.id} className={a.isHeader ? "header-row" : a.active ? "" : "inactive"}>
                  <td>{a.code}</td>
                  <td>{a.name}</td>
                  <td>{a.isHeader ? "" : a.type}</td>
                  <td>{a.book}</td>
                  <td>{a.profitCenterRule}</td>
                  <td>{a.subLedger}</td>
                  <td>{a.cashFlowGroup}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
