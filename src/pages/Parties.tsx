import { type FormEvent, useState } from "react";
import type { AppUser, Party } from "../../shared/types";
import { api, ApiRequestError } from "../lib/api";
import { useLoad } from "../lib/data";

const TYPES: Party["type"][] = ["Supplier", "Employee", "Owner", "Lender", "Platform", "Other"];
const ADDERS: Record<Party["type"], string[]> = {
  Supplier: ["Owner", "Accountant", "Supervisor", "Commissary In-charge"],
  Employee: ["Owner", "Accountant"],
  Owner: ["Owner"],
  Lender: ["Owner", "Accountant"],
  Platform: ["Owner", "Accountant"],
  Other: ["Owner", "Accountant"],
};

export default function Parties({ user }: { user: AppUser }) {
  const [type, setType] = useState<Party["type"]>("Supplier");
  const { data, error, reload } = useLoad<Party[]>(`/parties?all=1&type=${encodeURIComponent(type)}`);
  const [form, setForm] = useState({ name: "", contactDetails: "", paymentTerms: "", itemsSupplied: "", profitCenter: "", store: true, commissary: false });
  const [message, setMessage] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<{ name: string }[] | null>(null);
  const owner = user.role === "Owner";
  const manager = owner || user.role === "Accountant";
  const canAdd = ADDERS[type].includes(user.role);

  async function add(e: FormEvent, confirmDuplicate = false) {
    e.preventDefault();
    setMessage(null);
    try {
      const books = [...(form.store ? ["Store"] : []), ...(form.commissary ? ["Commissary"] : [])];
      const r = await api<{ approved: boolean }>("/parties", {
        method: "POST",
        body: JSON.stringify({ ...form, type, books, profitCenter: form.profitCenter || null, confirmDuplicate }),
      });
      setMessage(r.approved ? `${form.name} added.` : `${form.name} added and waiting for an owner's approval.`);
      setForm({ ...form, name: "", contactDetails: "", paymentTerms: "", itemsSupplied: "" });
      setDuplicates(null);
      reload();
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        setDuplicates((err.body.duplicates as { name: string }[]) ?? [{ name: "an existing entry" }]);
      } else setMessage(err instanceof Error ? err.message : "Could not add");
    }
  }

  async function act(path: string, body: object) {
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    }
  }

  const pending = (data ?? []).filter((p) => p.approvalStatus === "Pending");

  return (
    <section>
      <div className="page-head">
        <h1>Suppliers &amp; people</h1>
        <select value={type} onChange={(e) => setType(e.target.value as Party["type"])}>
          {TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      {type === "Employee" && <p className="muted">Employees can also be edited directly in the Airtable Parties table.</p>}
      {error && <p className="error">{error}</p>}

      {owner && pending.length > 0 && (
        <div className="card">
          <h2>Waiting for approval ({pending.length})</h2>
          {pending.map((p) => (
            <div key={p.id} className="row-actions">
              <strong>{p.name}</strong>
              <span className="muted">
                {p.paymentTerms} · {p.itemsSupplied} · added by {p.addedBy}
              </span>
              <span className="spacer" />
              <button className="link danger" onClick={() => act(`/parties/${p.id}/approval`, { approve: false })}>
                Reject
              </button>
              <button className="small" onClick={() => act(`/parties/${p.id}/approval`, { approve: true })}>
                Approve
              </button>
            </div>
          ))}
        </div>
      )}

      {canAdd && (
        <form className="card grid2" onSubmit={(e) => add(e)}>
          <h2 className="span2">Add {type.toLowerCase()}</h2>
          <label>
            Name *
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label>
            Contact details
            <input value={form.contactDetails} onChange={(e) => setForm({ ...form, contactDetails: e.target.value })} />
          </label>
          {type === "Supplier" && (
            <>
              <label>
                Payment terms *
                <input value={form.paymentTerms} placeholder="COD, 15 days…" onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} />
              </label>
              <label>
                Items supplied
                <input value={form.itemsSupplied} onChange={(e) => setForm({ ...form, itemsSupplied: e.target.value })} />
              </label>
            </>
          )}
          {type === "Employee" && (
            <label>
              Profit center
              <select value={form.profitCenter} onChange={(e) => setForm({ ...form, profitCenter: e.target.value })}>
                <option value="">Choose…</option>
                <option>GGC</option>
                <option>The Nest</option>
              </select>
            </label>
          )}
          <div className="span2 row-actions">
            Books:
            <label className="inline">
              <input type="checkbox" checked={form.store} onChange={(e) => setForm({ ...form, store: e.target.checked })} /> Store
            </label>
            <label className="inline">
              <input type="checkbox" checked={form.commissary} onChange={(e) => setForm({ ...form, commissary: e.target.checked })} /> Commissary
            </label>
          </div>
          {duplicates && (
            <div className="span2 warnings">
              Possible duplicate of: {duplicates.map((d) => d.name).join(", ")}.{" "}
              <button type="button" className="link" onClick={(e) => add(e as unknown as FormEvent, true)}>
                It's a different {type.toLowerCase()}; add anyway
              </button>
            </div>
          )}
          <div className="span2">
            <button type="submit">Add</button> {message && <span className="muted">{message}</span>}
          </div>
        </form>
      )}

      {data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                {type === "Supplier" && <th>Terms</th>}
                {type === "Supplier" && <th>Items</th>}
                <th>Books</th>
                {type === "Employee" && <th>Profit center</th>}
                <th>Status</th>
                {manager && <th />}
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id} className={p.active ? "" : "inactive"}>
                  <td>{p.name}</td>
                  {type === "Supplier" && <td>{p.paymentTerms}</td>}
                  {type === "Supplier" && <td>{p.itemsSupplied}</td>}
                  <td>{p.books.join(", ")}</td>
                  {type === "Employee" && <td>{p.profitCenter}</td>}
                  <td>{!p.active ? "Inactive" : p.type === "Supplier" ? (p.approvalStatus ?? "Pending") : "Active"}</td>
                  {manager && (
                    <td>
                      <button className="link" onClick={() => act(`/parties/${p.id}/active`, { active: !p.active })}>
                        {p.active ? "Deactivate" : "Reactivate"}
                      </button>
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
