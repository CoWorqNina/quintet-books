import { accountMatches } from "../../shared/accounts";
import type { Attachment } from "../../shared/entries";
import { formatPeso, sumCents, toCents } from "../../shared/money";
import { type Field, type Row, type TemplateContext, type Values, visibleFields } from "../../shared/templates";
import type { Account, Party } from "../../shared/types";
import { AttachmentPicker, MoneyInput } from "./inputs";

/** Renders a template's fields (including repeating line rows) and reports changes. */
export function TemplateForm({
  fields,
  values,
  onChange,
  ctx,
  accountList,
  parties,
  maxDate,
  minDate,
}: {
  fields: Field[];
  values: Values;
  onChange: (v: Values) => void;
  ctx: TemplateContext;
  accountList: Account[];
  parties: Party[];
  maxDate: string;
  minDate: string;
}) {
  const set = (name: string, v: Values[string]) => onChange({ ...values, [name]: v });

  return (
    <div className="grid2">
      {visibleFields(fields, values, ctx).map((f) =>
        f.type === "rows" ? (
          <div key={f.name} className="span2">
            <RowsField field={f} rows={(values[f.name] as Row[]) ?? []} onChange={(rows) => set(f.name, rows)} {...{ ctx, accountList, parties }} />
          </div>
        ) : f.type === "checkbox" ? (
          <label key={f.name} className="inline span2">
            <input type="checkbox" checked={!!values[f.name]} onChange={(e) => set(f.name, e.target.checked)} />
            {f.label}
          </label>
        ) : (
          <label key={f.name}>
            {f.label}
            {f.required ? " *" : ""}
            <Control field={f} value={values[f.name] as Row[string]} onChange={(v) => set(f.name, v)} {...{ ctx, accountList, parties, maxDate, minDate }} />
            {f.help && <small className="muted">{f.help}</small>}
          </label>
        ),
      )}
    </div>
  );
}

function RowsField({
  field,
  rows,
  onChange,
  ctx,
  accountList,
  parties,
}: {
  field: Field;
  rows: Row[];
  onChange: (rows: Row[]) => void;
  ctx: TemplateContext;
  accountList: Account[];
  parties: Party[];
}) {
  const update = (i: number, name: string, v: Row[string]) => onChange(rows.map((r, j) => (j === i ? { ...r, [name]: v } : r)));
  const total = sumCents(rows.map((r) => toCents(r.amount as string)));
  return (
    <div>
      <span className="label">
        {field.label}
        {field.required ? " *" : ""}
      </span>
      {rows.map((row, i) => {
        const account = accountList.find((a) => a.code === row.account);
        return (
          <div key={i} className="row-card">
            <div className="grid4">
              {visibleFields(field.columns ?? [], row, ctx)
                .filter((c) => !(c.help === "Ingredients" && !(account?.type === "COGS" && account.code !== "5199")))
                .map((c) => (
                  <label key={c.name}>
                    {c.label}
                    <Control field={c} value={row[c.name]} onChange={(v) => update(i, c.name, v)} {...{ ctx, accountList, parties, maxDate: "", minDate: "" }} />
                  </label>
                ))}
            </div>
            <div className="row-actions">
              <span className="spacer" />
              <button type="button" className="link danger" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                Remove line
              </button>
            </div>
          </div>
        );
      })}
      <div className="row-actions">
        <button type="button" className="secondary" onClick={() => onChange([...rows, { profitCenter: ctx.profitCenter }])}>
          + Add line
        </button>
        <span className="spacer" />
        {rows.length > 0 && <strong>Total {formatPeso(total)}</strong>}
      </div>
    </div>
  );
}

function Control({
  field: f,
  value: v,
  onChange,
  ctx,
  accountList,
  parties,
  maxDate,
  minDate,
}: {
  field: Field;
  value: Row[string];
  onChange: (v: Row[string]) => void;
  ctx: TemplateContext;
  accountList: Account[];
  parties: Party[];
  maxDate: string;
  minDate: string;
}) {
  switch (f.type) {
    case "date":
      return <input type="date" min={minDate || undefined} max={maxDate || undefined} value={String(v ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "money":
    case "number":
      return <MoneyInput value={v as string} onChange={onChange} />;
    case "select":
      return (
        <select value={String(v ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {f.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "profitCenter":
      return (
        <select value={String(v ?? ctx.profitCenter)} onChange={(e) => onChange(e.target.value)}>
          <option value="GGC">GGC</option>
          <option value="The Nest">The Nest</option>
        </select>
      );
    case "account": {
      const options = accountList.filter((a) => accountMatches(f.filter ?? "postable", a, ctx));
      const groups = [...new Set(options.map((a) => a.statementLine))];
      return (
        <select value={String(v ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">{options.length ? "Choose account…" : "No accounts available"}</option>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {options
                .filter((a) => a.statementLine === g)
                .map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} {a.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      );
    }
    case "party": {
      const options = parties.filter((p) => p.type === f.partyType && p.active);
      return (
        <select value={String(v ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">{options.length ? `Choose ${f.partyType?.toLowerCase()}…` : `No ${f.partyType?.toLowerCase()}s yet`}</option>
          {options.map((p) => (
            <option key={p.id} value={p.id} disabled={!p.approved}>
              {p.name}
              {p.approved ? "" : " (waiting for approval)"}
            </option>
          ))}
        </select>
      );
    }
    case "product": {
      const products = [...(ctx.products?.values() ?? [])].filter((p) => p.active);
      return (
        <select value={String(v ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">{products.length ? "Choose product…" : "No products yet"}</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.unit})
            </option>
          ))}
        </select>
      );
    }
    case "loan": {
      const loans = [...(ctx.loans?.values() ?? [])];
      return (
        <select value={String(v ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">{loans.length ? "Choose loan…" : "No loans recorded yet"}</option>
          {loans.map((l) => (
            <option key={l.id} value={String(l.id)}>
              {l.name}
            </option>
          ))}
        </select>
      );
    }
    case "attachment":
      return <AttachmentPicker value={v && typeof v === "object" ? [v as Attachment] : []} onChange={(list) => onChange(list[0] ?? null)} />;
    default:
      return <input value={String(v ?? "")} onChange={(e) => onChange(e.target.value)} />;
  }
}
