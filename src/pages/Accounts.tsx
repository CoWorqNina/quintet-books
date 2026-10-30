import { useEffect, useMemo, useState } from "react";
import type { Account, AppUser } from "../../shared/types";
import { api } from "../lib/api";

export default function Accounts({ user }: { user: AppUser }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const [version, setVersion] = useState(0);
  const isOwner = user.role === "Owner";

  useEffect(() => {
    api<Account[]>("/accounts")
      .then(setAccounts)
      .catch((e: Error) => setError(e.message));
  }, [version]);

  async function toggle(a: Account) {
    const reason = prompt(`${a.active ? "Deactivate" : "Reactivate"} ${a.code} ${a.name}?\n\nReason (goes to the Judgment Log):`);
    if (!reason?.trim()) return;
    try {
      await api(`/accounts/${a.code}/active`, { method: "POST", body: JSON.stringify({ active: !a.active, reason }) });
      setVersion(version + 1);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not change the account");
    }
  }

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!accounts || !q) return accounts;
    return accounts.filter((a) => a.code.includes(q) || a.name.toLowerCase().includes(q));
  }, [accounts, filter]);

  return (
    <section>
      <div className="page-head">
        <h1>Chart of Accounts</h1>
        <input placeholder="Search code or name" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {isOwner && <button onClick={() => setAdding(!adding)}>{adding ? "Close" : "Add account"}</button>}
      </div>
      {adding && accounts && (
        <AddAccount
          accounts={accounts}
          onDone={() => {
            setAdding(false);
            setVersion(version + 1);
          }}
        />
      )}
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
                {isOwner && <th />}
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
                  {isOwner && (
                    <td>
                      {!a.isHeader && (
                        <button className="link" onClick={() => toggle(a)}>
                          {a.active ? "Deactivate" : "Reactivate"}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** New account under a header; it copies its settings from an account already under that header. */
function AddAccount({ accounts, onDone }: { accounts: Account[]; onDone: () => void }) {
  const headers = accounts.filter((a) => a.isHeader && accounts.some((x) => x.parentCode === a.code && !x.isHeader));
  const [parentCode, setParentCode] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const siblings = accounts.filter((a) => a.parentCode === parentCode && !a.isHeader);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api("/accounts", { method: "POST", body: JSON.stringify({ parentCode, code, name, description, reason }) });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the account");
    }
    setBusy(false);
  }

  return (
    <div className="card grid2">
      <label>
        Goes under
        <select value={parentCode} onChange={(e) => setParentCode(e.target.value)}>
          <option value="">Choose…</option>
          {headers.map((h) => (
            <option key={h.code} value={h.code}>
              {h.code} {h.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Code
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={siblings.length ? `after ${siblings[siblings.length - 1].code}` : ""} />
      </label>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Description
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="span2">
        Why it's needed (Judgment Log)
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {siblings[0] && (
        <p className="muted span2">
          Settings copied from {siblings[0].code} {siblings[0].name}: {siblings[0].type}, {siblings[0].book}, {siblings[0].profitCenterRule ?? "no profit center"}, cash flow {siblings[0].cashFlowGroup ?? "n/a"}.
        </p>
      )}
      {error && <p className="error span2">{error}</p>}
      <button disabled={busy || !parentCode || !code || !name || !reason} onClick={save}>
        {busy ? "Adding…" : "Add account"}
      </button>
    </div>
  );
}
