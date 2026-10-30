import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { GO_LIVE_DATE } from "../../shared/config";
import { type LoanInfo, type Product, type TemplateContext, templatesFor, type Values } from "../../shared/templates";
import type { AppUser, Book, JournalEntry } from "../../shared/types";
import { EntryPreview } from "../components/EntryPreview";
import { TemplateForm } from "../components/TemplateForm";
import { api } from "../lib/api";
import { todayManila, useAccounts, useLoad, useParties } from "../lib/data";

interface SavedForm {
  template: number;
  book: Book;
  profitCenter: "GGC" | "The Nest";
  values: Values;
}

/** Correcting an approved entry: loads the form it was built from, then reverses and re-enters it. */
export function CorrectEntry({ user }: { user: AppUser }) {
  const { id } = useParams();
  const { data, error } = useLoad<{ entry: JournalEntry; form: SavedForm | null }>(`/entries/${id}`);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  if (!data.form || !data.entry.correctable) return <p>Entry #{id} can't be corrected here. Reverse it from the journal and enter it again.</p>;
  return <NewEntry user={user} correcting={{ entry: data.entry, form: data.form }} />;
}

export default function NewEntry({ user, correcting }: { user: AppUser; correcting?: { entry: JournalEntry; form: SavedForm } }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const templates = templatesFor(user.role, user.books);
  const pcs = user.profitCenters.filter((p): p is "GGC" | "The Nest" => p === "GGC" || p === "The Nest");
  const saved = correcting?.form;
  const [number, setNumber] = useState(saved?.template ?? (Number(params.get("template")) || templates[0]?.number || 0));
  const template = templates.find((t) => t.number === number);
  const books = (template?.books ?? []).filter((b) => user.books.includes(b));
  const [book, setBook] = useState<Book>(saved?.book ?? books[0] ?? "Store");
  const [profitCenter, setProfitCenter] = useState<"GGC" | "The Nest">(saved?.profitCenter ?? pcs[0] ?? "GGC");
  const [values, setValues] = useState<Values>(saved?.values ?? { date: todayManila() });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (template && !template.books.includes(book) && !saved) setBook(books[0] ?? "Store");
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
      if (correcting) {
        await api(`/entries/${correcting.entry.id}/reverse`, { method: "POST", body: JSON.stringify({ reason, values }) });
      } else {
        await api("/entries", { method: "POST", body: JSON.stringify({ template: number, book: ctx.book, profitCenter, values }) });
      }
      navigate("/journal");
    } catch (e) {
      setServerError(e instanceof Error ? e.message : "Could not save");
    }
    setBusy(false);
  }

  return (
    <section className="form-page">
      <h1>{correcting ? `Correct entry #${correcting.entry.id}` : "New entry"}</h1>
      {correcting && (
        <div className="card">
          <p>
            Saving reverses entry #{correcting.entry.id} ({correcting.entry.templateName}, {correcting.entry.entryDate}) and records the
            corrected one below. Both go to an Owner for approval together.
          </p>
          <label>
            Reason for the correction
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong supplier, amount was ₱1,250" />
          </label>
        </div>
      )}
      <div className="card grid2">
        <label>
          Transaction type
          <select
            disabled={!!correcting}
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
            <select value={book} onChange={(e) => setBook(e.target.value as Book)} disabled={!!correcting}>
              {books.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </label>
        )}
        {ctx.book === "Store" && (!template.twoBook || template.fields.some((f) => f.filter === "payFrom")) && (
          <label>
            Profit center
            <select value={profitCenter} onChange={(e) => setProfitCenter(e.target.value as "GGC" | "The Nest")} disabled={pcs.length < 2 || !!correcting}>
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
        <button disabled={busy || !built?.entries.length || built.errors.length > 0 || (!!correcting && !reason.trim())} onClick={submit}>
          {busy ? "Submitting…" : correcting ? "Reverse and submit correction" : "Submit for approval"}
        </button>
      </div>
    </section>
  );
}
