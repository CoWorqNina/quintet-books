import { useState } from "react";
import type { AppUser, Role } from "../../shared/types";
import { api } from "../lib/api";
import { useLoad } from "../lib/data";

interface UserRow {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  books: string[];
  profitCenters: string[];
  active: boolean;
}

const ROLES: Role[] = ["Owner", "Accountant", "Supervisor", "Staff", "Commissary In-charge"];
const ROLE_HELP: Record<Role, string> = {
  Owner: "Everything, including approvals, closing months and managing users",
  Accountant: "All entries, ledger, statements and month-end; can't approve",
  Supervisor: "Daily reports, deposits and entries for their store; inventory counts",
  Staff: "Daily reports and their own entries",
  "Commissary In-charge": "Commissary entries, billings and counts",
};

/** Who can sign in, with what role, books and profit centers (Owners only). */
export default function Users({ user }: { user: AppUser }) {
  const { data, error, reload } = useLoad<UserRow[]>("/users");
  const [editing, setEditing] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  return (
    <section>
      <div className="page-head">
        <h1>Users</h1>
        <button onClick={() => setInviting(!inviting)}>{inviting ? "Close" : "Invite someone"}</button>
      </div>
      <p className="muted">Review this list now and then: remove access for anyone who has left. Every change is kept in the audit log.</p>
      {inviting && (
        <UserForm
          onDone={() => {
            setInviting(false);
            reload();
          }}
        />
      )}
      {error && <p className="error">{error}</p>}
      {data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Books</th>
                <th>Profit centers</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((u) => [
                <tr key={u.id} className={u.active ? "" : "inactive"}>
                  <td>
                    {u.fullName}
                    {u.id === user.id && <span className="muted"> (you)</span>}
                  </td>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>{u.books.join(", ")}</td>
                  <td>{u.profitCenters.join(", ")}</td>
                  <td>
                    <button className="link" onClick={() => setEditing(editing === u.id ? null : u.id)}>
                      {editing === u.id ? "Close" : "Edit"}
                    </button>
                  </td>
                </tr>,
                editing === u.id && (
                  <tr key={`${u.id}-edit`}>
                    <td colSpan={6}>
                      <UserForm
                        existing={u}
                        self={u.id === user.id}
                        onDone={() => {
                          setEditing(null);
                          reload();
                        }}
                      />
                    </td>
                  </tr>
                ),
              ])}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function UserForm({ existing, self, onDone }: { existing?: UserRow; self?: boolean; onDone: () => void }) {
  const [email, setEmail] = useState(existing?.email ?? "");
  const [fullName, setFullName] = useState(existing?.fullName ?? "");
  const [role, setRole] = useState<Role>(existing?.role ?? "Staff");
  const [books, setBooks] = useState<string[]>(existing?.books ?? ["Store"]);
  const [pcs, setPcs] = useState<string[]>(existing?.profitCenters ?? ["GGC"]);
  const [active, setActive] = useState(existing?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toggle = (list: string[], v: string, set: (x: string[]) => void) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const body = { fullName, role, books, profitCenters: pcs, active };
      if (existing) await api(`/users/${existing.id}`, { method: "PATCH", body: JSON.stringify(body) });
      else await api("/users", { method: "POST", body: JSON.stringify({ ...body, email }) });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
    }
    setBusy(false);
  }

  return (
    <div className="card grid2">
      {!existing && (
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      )}
      <label>
        Name
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </label>
      <label>
        Role
        <select value={role} disabled={self} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <span className="muted">{ROLE_HELP[role]}</span>
      </label>
      <div>
        <span className="label">Books</span>
        {["Store", "Commissary"].map((b) => (
          <label key={b} className="inline">
            <input type="checkbox" checked={books.includes(b)} onChange={() => toggle(books, b, setBooks)} /> {b}
          </label>
        ))}
      </div>
      <div>
        <span className="label">Profit centers</span>
        {["GGC", "The Nest"].map((p) => (
          <label key={p} className="inline">
            <input type="checkbox" checked={pcs.includes(p)} onChange={() => toggle(pcs, p, setPcs)} /> {p}
          </label>
        ))}
      </div>
      {existing && (
        <label className="inline">
          <input type="checkbox" checked={active} disabled={self} onChange={(e) => setActive(e.target.checked)} /> Can sign in
        </label>
      )}
      {!existing && <p className="muted span2">They get an email from Supabase with a link to set their password.</p>}
      {err && <p className="error span2">{err}</p>}
      <button disabled={busy} onClick={save}>
        {busy ? "Saving…" : existing ? "Save changes" : "Send invitation"}
      </button>
    </div>
  );
}
