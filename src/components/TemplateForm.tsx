import { accountMatches } from "../../shared/accounts";
import { todayManila } from "../lib/data";
import type { Attachment } from "../../shared/entries";
import { formatPeso, sumCents, toCents } from "../../shared/money";
import { billLabel, type OpenBill } from "../../shared/ledger";
import { billsFor, type DueInstallment, type Field, installmentsFor, type Row, type TemplateContext, type Values, visibleFields } from "../../shared/templates";
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
        ) : f.type === "openItems" ? (
          <div key={f.name} className="span2">
            <BillsField field={f} bills={billsFor(f, values, ctx)} rows={(values[f.name] as Row[]) ?? []} onChange={(rows) => set(f.name, rows)} />
            {f.itemsAll && (
              <InstallmentsField installments={installmentsFor(ctx)} rows={(values[f.name] as Row[]) ?? []} onChange={(rows) => set(f.name, rows)} />
            )}
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

/** Unpaid bills with a tick box each; the amount defaults to what's unpaid and can be lowered. */
function BillsField({ field, bills, rows: all, onChange: setAll }: { field: Field; bills: OpenBill[]; rows: Row[]; onChange: (rows: Row[]) => void }) {
  // Loan installment rows (combined payment) are kept as they are; this table handles bills only.
  const others = all.filter((r) => r.installmentId);
  const rows = all.filter((r) => !r.installmentId);
  const onChange = (next: Row[]) => setAll([...next, ...others]);
  const picked = new Map(rows.map((r) => [Number(r.lineId), r]));
  const toggle = (b: OpenBill, on: boolean) =>
    onChange(on ? [...rows, { lineId: b.lineId, amount: (Math.max(0, b.openCents - b.pendingCents) / 100).toFixed(2) }] : rows.filter((r) => Number(r.lineId) !== b.lineId));
  const setAmount = (b: OpenBill, amount: string) => onChange(rows.map((r) => (Number(r.lineId) === b.lineId ? { ...r, amount } : r)));
  const total = sumCents(rows.filter((r) => bills.some((b) => b.lineId === Number(r.lineId))).map((r) => toCents(r.amount as string)));
  const today = todayManila();
  const allOn = bills.length > 0 && bills.every((b) => picked.has(b.lineId));
  return (
    <div>
      <span className="label">
        {field.label}
        {field.required ? " *" : ""}
      </span>
      {field.help && <small className="muted"> {field.help}</small>}
      {bills.length === 0 ? (
        <p className="muted">{field.itemsPartyField || field.itemsAccountField ? "No unpaid bills here (or choose above first)." : "No unpaid bills."}</p>
      ) : (
        <div className="table-wrap">
          <table className="bills">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Tick all"
                    checked={allOn}
                    onChange={(e) => onChange(e.target.checked ? bills.map((b) => picked.get(b.lineId) ?? { lineId: b.lineId, amount: (b.openCents / 100).toFixed(2) }) : [])}
                  />
                </th>
                <th style={{ textAlign: "left" }}>Date</th>
                <th style={{ textAlign: "left" }}>Due</th>
                <th style={{ textAlign: "left" }}>Bill</th>
                <th>Unpaid</th>
                <th>Paying now</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => {
                const row = picked.get(b.lineId);
                const overdue = b.dueDate && b.dueDate < today;
                return (
                  <tr key={b.lineId}>
                    <td>
                      <input type="checkbox" checked={!!row} onChange={(e) => toggle(b, e.target.checked)} />
                    </td>
                    <td>{b.date}</td>
                    <td className={overdue ? "danger" : ""}>{b.dueDate ?? "—"}</td>
                    <td>
                      {billLabel(b)}
                      {b.party && !billLabel(b).includes(b.party) && <span className="muted"> · {b.party}</span>}
                      {b.pendingCents > 0 && <div className="danger small">{formatPeso(b.pendingCents)} already in a payment waiting for approval</div>}
                    </td>
                    <td className="num">{formatPeso(b.openCents)}</td>
                    <td className="num">{row ? <MoneyInput value={row.amount as string} onChange={(v) => setAmount(b, v)} /> : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="row-actions">
        <span className="spacer" />
        {rows.length > 0 && <strong>Total {formatPeso(total)}</strong>}
      </div>
    </div>
  );
}

/** Loan installments a combined payment can include: always the full scheduled amount. */
function InstallmentsField({ installments, rows, onChange }: { installments: DueInstallment[]; rows: Row[]; onChange: (rows: Row[]) => void }) {
  const picked = new Set(rows.filter((r) => r.installmentId).map((r) => Number(r.installmentId)));
  const amount = (i: DueInstallment) => (i.principal + i.interest).toFixed(2);
  const toggle = (i: DueInstallment, on: boolean) =>
    onChange(on ? [...rows, { installmentId: i.id, amount: amount(i) }] : rows.filter((r) => Number(r.installmentId) !== i.id));
  const today = todayManila();
  const grand = sumCents(rows.map((r) => toCents(r.amount as string)));
  return (
    <div style={{ marginTop: "0.75rem" }}>
      <span className="label">Loan installments</span>
      {installments.length === 0 ? (
        <p className="muted">No unpaid loan installments.</p>
      ) : (
        <div className="table-wrap">
          <table className="bills">
            <thead>
              <tr>
                <th />
                <th style={{ textAlign: "left" }}>Due</th>
                <th style={{ textAlign: "left" }}>Loan</th>
                <th>Principal + interest</th>
              </tr>
            </thead>
            <tbody>
              {installments.map((i) => (
                <tr key={i.id}>
                  <td>
                    <input type="checkbox" checked={picked.has(i.id)} onChange={(e) => toggle(i, e.target.checked)} />
                  </td>
                  <td className={i.dueDate < today ? "danger" : ""}>{i.dueDate}</td>
                  <td>
                    {i.loanName} <span className="muted">· installment {i.seq} of {i.count}</span>
                  </td>
                  <td className="num">{formatPeso(toCents(amount(i)))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row-actions">
        <span className="spacer" />
        {rows.length > 0 && <strong>Total of this payment {formatPeso(grand)}</strong>}
      </div>
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
  // Lines without an amount column (e.g. products) are quantity × price.
  const total = sumCents(
    rows.map((r) => (r.amount !== undefined ? toCents(r.amount as string) : toCents((Number(r.quantity) || 0) * (Number(r.unitPrice) || 0)))),
  );
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
      const fctx = f.book ? { book: f.book, profitCenter: f.book === "Commissary" ? ("GGC" as const) : ctx.profitCenter } : ctx;
      const options = accountList.filter((a) => accountMatches(f.filter ?? "postable", a, fctx));
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
