import { useState } from "react";
import { formatPeso, sumCents, toCents } from "../../shared/money";
import type { JournalEntry } from "../../shared/types";
import { EntryCard } from "../components/EntryCard";
import { api } from "../lib/api";
import { useLoad } from "../lib/data";

export default function Approvals() {
  const { data, error, reload } = useLoad<JournalEntry[]>("/entries/approvals");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const batchable = (data ?? []).filter((e) => e.canBatchApprove);
  const oneByOne = (data ?? []).filter((e) => !e.canBatchApprove);

  async function approve(ids: number[]) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api<{ approved: number }>("/entries/approve", { method: "POST", body: JSON.stringify({ ids }) });
      setMessage(`Approved ${r.approved} ${r.approved === 1 ? "entry" : "entries"}.`);
      setSelected(new Set());
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not approve");
    }
    setBusy(false);
  }

  async function reject(entry: JournalEntry) {
    const reason = prompt(`Reject entry #${entry.id}? The encoder will see your reason.\n\nReason:`);
    if (!reason?.trim()) return;
    try {
      await api(`/entries/${entry.id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not reject");
    }
  }

  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectedTotal = sumCents(batchable.filter((e) => selected.has(e.id)).map((e) => toCents(e.totalDebit)));

  const actions = (e: JournalEntry) => (
    <>
      <button className="link danger" disabled={busy} onClick={() => reject(e)}>
        Reject
      </button>
      <button className="small" disabled={busy} onClick={() => approve([e.id])}>
        Approve
      </button>
    </>
  );

  return (
    <section>
      <h1>Approvals</h1>
      <p className="muted">Entries waiting for an owner. You never see your own entries here; the other owner approves them.</p>
      {error && <p className="error">{error}</p>}
      {message && <p className="notice">{message}</p>}
      {data && !data.length && <p className="muted">Nothing waiting for approval.</p>}

      {batchable.length > 0 && (
        <>
          <div className="page-head sticky">
            <h2>Routine entries ({batchable.length})</h2>
            <button className="link" onClick={() => setSelected(new Set(batchable.map((e) => e.id)))}>
              Select all
            </button>
            <button className="link" onClick={() => setSelected(new Set())}>
              Clear
            </button>
            <button disabled={busy || !selected.size} onClick={() => approve([...selected])}>
              Approve {selected.size || ""} selected {selected.size ? `(${formatPeso(selectedTotal)})` : ""}
            </button>
          </div>
          {batchable.map((e) => (
            <EntryCard
              key={e.id}
              entry={e}
              select={<input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} />}
              actions={actions(e)}
            />
          ))}
        </>
      )}

      {oneByOne.length > 0 && (
        <>
          <h2>Approve one by one ({oneByOne.length})</h2>
          <p className="muted">Entries without receipts and non-routine entries need individual review.</p>
          {oneByOne.map((e) => (
            <EntryCard key={e.id} entry={e} actions={actions(e)} />
          ))}
        </>
      )}
    </section>
  );
}
