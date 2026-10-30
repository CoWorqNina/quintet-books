import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { GO_LIVE_DATE } from "../../shared/config";
import { type LoanInfo, type Product, type TemplateContext, templatesFor, type Values } from "../../shared/templates";
import type { AppUser, Book } from "../../shared/types";
import { EntryPreview } from "../components/EntryPreview";
import { TemplateForm } from "../components/TemplateForm";
import { api } from "../lib/api";
import { todayManila, useAccounts, useLoad, useParties } from "../lib/data";

export default function NewEntry({ user }: { user: AppUser }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const templates = templatesFor(user.role, user.books);
  const pcs = user.profitCenters.filter((p): p is "GGC" | "The Nest" => p === "GGC" || p === "The Nest");
  const [number, setNumber] = useState(Number(params.get("template")) || templates[0]?.number || 0);
  const template = templates.find((t) => t.number === number);
  const books = (template?.books ?? []).filter((b) => user.books.includes(b));
  const [book, setBook] = useState<Book>(books[0] ?? "Store");
  const [profitCenter, setProfitCenter] = useState<"GGC" | "The Nest">(pcs[0] ?? "GGC");
  const [values, setValues] = useState<Values>({ date: todayManila() });
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (template && !template.books.includes(book)) setBook(books[0] ?? "Store");
  }, [number]); // eslint-disable-line react-hooks/exhaustive-deps

  const accountList = useAccounts();
  const parties = useParties();
  const needsProducts = template?.fields.some((f) => f.type === "rows" && f.columns?.some((c) => c.type === "product"));
  const needsLoans = template?.fields.some((f) => f.type === "loan");
  const products = useLoad<Product[]>(needsProducts ? "/products" : null).data;
  const loans = useLoad<LoanInfo[]>(needsLoans ? "/loans" : null).data;
  const dueToCommissary = useLoad<{ cents: number }>(number === 21 ? "/balances/due-to-commissary" : null).data;

  const ctx: TemplateContext = useMemo(
    () => ({
      book: template?.twoBook ? "Store" : book,
      profitCenter: book === "Commissary" && !template?.twoBook ? "GGC" : profitCenter,
      accounts: new Map(accountList.map((a) => [a.code, a])),
      parties: new Map(parties.map((p) => [p.id, p])),
      products: new Map((products ?? []).map((p) => [p.id, p])),
      loans: new Map((loans ?? []).map((l) => [String(l.id), l])),
      dueToCommissaryCents: dueToCommissary?.cents,
    }),
    [template, book, profitCenter, accountList, parties, products, loans, dueToCommissary],
  );

  if (!template) return <p>Your role has no entry forms here.</p>;
  const built = accountList.length ? template.build(values, ctx) : null;
  const groups = [...new Set(templates.map((t) => t.group))];

  async function submit() {
    setBusy(true);
    setServerError(null);
    try {
      await api("/entries", { method: "POST", body: JSON.stringify({ template: number, book: ctx.book, profitCenter, values }) });
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
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {templates
                  .filter((t) => t.group === g)
                  .map((t) => (
                    <option key={t.number} value={t.number}>
                      #{t.number} {t.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        {!template.twoBook && books.length > 1 && (
          <label>
            Book
            <select value={book} onChange={(e) => setBook(e.target.value as Book)}>
              {books.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </label>
        )}
        {ctx.book === "Store" && (!template.twoBook || template.fields.some((f) => f.filter === "payFrom")) && (
          <label>
            Profit center
            <select value={profitCenter} onChange={(e) => setProfitCenter(e.target.value as "GGC" | "The Nest")} disabled={pcs.length < 2}>
              {pcs.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
        )}
        {template.twoBook && <p className="muted span2">This posts in both the Store and Commissary books at once.</p>}
      </div>

      <div className="card">
        <TemplateForm
          fields={template.fields}
          values={values}
          onChange={setValues}
          ctx={ctx}
          accountList={accountList}
          parties={parties}
          minDate={GO_LIVE_DATE}
          maxDate={todayManila()}
        />
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
        {built && <EntryPreview entries={built.entries} accounts={ctx.accounts} />}
        {serverError && <p className="error">{serverError}</p>}
        <button disabled={busy || !built?.entries.length || built.errors.length > 0} onClick={submit}>
          {busy ? "Submitting…" : "Submit for approval"}
        </button>
      </div>
    </section>
  );
}
