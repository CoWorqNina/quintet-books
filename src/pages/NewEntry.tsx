import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Attachment } from "../../shared/entries";
import { isBankAccount, isStoreCashAccount } from "../../shared/accounts";
import { TEMPLATES, type Values } from "../../shared/templates";
import type { AppUser } from "../../shared/types";
import { GO_LIVE_DATE } from "../../shared/config";
import { EntryPreview } from "../components/EntryPreview";
import { AttachmentPicker, ExpenseAccountSelect, MoneyInput } from "../components/inputs";
import { api } from "../lib/api";
import { todayManila, useAccounts } from "../lib/data";

export default function NewEntry({ user }: { user: AppUser }) {
  const navigate = useNavigate();
  const templates = TEMPLATES.filter((t) => t.roles.includes(user.role));
  const pcs = user.profitCenters.filter((p): p is "GGC" | "The Nest" => p === "GGC" || p === "The Nest");
  const [number, setNumber] = useState(templates[0]?.number ?? 0);
  const [profitCenter, setProfitCenter] = useState<"GGC" | "The Nest">(pcs[0] ?? "GGC");
  const [values, setValues] = useState<Values>({ date: todayManila() });
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const accountList = useAccounts();
  const accounts = useMemo(() => new Map(accountList.map((a) => [a.code, a])), [accountList]);
  const template = templates.find((t) => t.number === number);
  if (!template) return <p>Your role has no entry forms here.</p>;

  const fields = template.fields.filter(
    (f) => !f.showIf || f.showIf.values.includes(String(values[f.showIf.field] ?? "")),
  );
  const built = accountList.length ? template.build(values, { profitCenter, accounts }) : null;
  const set = (name: string, v: Values[string]) => setValues((old) => ({ ...old, [name]: v }));

  async function submit() {
    setBusy(true);
    setServerError(null);
    try {
      await api("/entries", { method: "POST", body: JSON.stringify({ template: number, profitCenter, values }) });
      navigate("/journal");
    } catch (e) {
      setServerError(e instanceof Error ? e.message : "Could not save");
    }
    setBusy(false);
  }

  return (
    <section className="form-page">
      <h1>New entry</h1>
      <div className="card grid2">
        <label>
          Transaction type
          <select
            value={number}
            onChange={(e) => {
              setNumber(Number(e.target.value));
              setValues({ date: values.date });
            }}
          >
            {templates.map((t) => (
              <option key={t.number} value={t.number}>
                #{t.number} {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Profit center
          <select value={profitCenter} onChange={(e) => setProfitCenter(e.target.value as "GGC" | "The Nest")} disabled={pcs.length < 2}>
            {pcs.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="card grid2">
        {fields.map((f) => {
          const v = values[f.name];
          let control;
          switch (f.type) {
            case "date":
              control = <input type="date" min={GO_LIVE_DATE} max={todayManila()} value={String(v ?? "")} onChange={(e) => set(f.name, e.target.value)} />;
              break;
            case "money":
            case "number":
              control = <MoneyInput value={v as string} onChange={(x) => set(f.name, x)} />;
              break;
            case "select":
              control = (
                <select value={String(v ?? "")} onChange={(e) => set(f.name, e.target.value)}>
                  <option value="">Choose…</option>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              );
              break;
            case "bankAccount":
            case "cashAccount": {
              const ok = f.type === "bankAccount" ? isBankAccount : isStoreCashAccount;
              control = (
                <select value={String(v ?? "")} onChange={(e) => set(f.name, e.target.value)}>
                  <option value="">Choose account…</option>
                  {accountList.filter(ok).map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} {a.name}
                    </option>
                  ))}
                </select>
              );
              break;
            }
            case "expenseAccount":
              control = (
                <ExpenseAccountSelect accounts={accountList} profitCenter={profitCenter} value={v as string} onChange={(x) => set(f.name, x)} />
              );
              break;
            case "attachment":
              control = (
                <AttachmentPicker value={v ? [v as Attachment] : []} onChange={(list) => set(f.name, list[0] ?? null)} />
              );
              break;
            case "checkbox":
              return (
                <label key={f.name} className="inline span2">
                  <input type="checkbox" checked={!!v} onChange={(e) => set(f.name, e.target.checked)} />
                  {f.label}
                </label>
              );
            default:
              control = <input value={String(v ?? "")} onChange={(e) => set(f.name, e.target.value)} />;
          }
          return (
            <label key={f.name}>
              {f.label}
              {f.required ? " *" : ""}
              {control}
              {f.help && <small className="muted">{f.help}</small>}
            </label>
          );
        })}
      </div>

      <div className="card">
        <h2>Entry preview</h2>
        {built?.errors.length ? (
          <ul className="errors">
            {built.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}
        {built?.entry && <EntryPreview entries={[built.entry]} accounts={accounts} />}
        {serverError && <p className="error">{serverError}</p>}
        <button disabled={busy || !built?.entry || built.errors.length > 0} onClick={submit}>
          {busy ? "Submitting…" : "Submit for approval"}
        </button>
      </div>
    </section>
  );
}
