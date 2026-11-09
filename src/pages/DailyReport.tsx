import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { cashAccountsFor, isBankAccount, needsQuantity } from "../../shared/accounts";
import { buildDailyReport, type DailyReportInput, type PaidOut } from "../../shared/dailyReport";
import type { Attachment } from "../../shared/entries";
import { formatPeso, toCents } from "../../shared/money";
import type { AppUser } from "../../shared/types";
import { GO_LIVE_DATE } from "../../shared/config";
import { EntryPreview } from "../components/EntryPreview";
import { AttachmentPicker, EmployeeSelect, ExpenseAccountSelect, MoneyInput } from "../components/inputs";
import { api } from "../lib/api";
import { todayManila, useAccounts, useEmployees, useLoad, useParties } from "../lib/data";

type Num = string;
interface PaidOutRow extends Omit<PaidOut, "amount" | "quantity" | "unitPrice"> {
  amount: Num;
  quantity: Num;
  unitPrice: Num;
}

const emptyPaidOut = (): PaidOutRow => ({ kind: "expense", description: "", amount: "", quantity: "", unit: "", unitPrice: "" });
const POS_FIELDS = [
  ["cash", "Cash"],
  ["card", "Card"],
  ["gcash", "GCash"],
  ["foodCharges", "Food charges"],
] as const;

/** A daily report as saved (to edit it). */
interface StoredReport {
  id: number;
  business_date: string;
  profit_center: "GGC" | "The Nest";
  pos: Record<string, number | string | null>;
  drawer: Record<string, unknown> & { cashIns?: { amount: number; sourceAccount: string; reference: string }[] };
  paid_outs: PaidOut[];
  food_charges: { employeeId: string; employeeName: string; amount: number }[];
  attachments: Attachment[];
  notes: string | null;
}

const str = (v: unknown) => (v === null || v === undefined || v === 0 ? "" : String(v));

/** Editing a report still waiting for approval: loads it into the same form. */
export function EditDailyReport({ user }: { user: AppUser }) {
  const { id } = useParams();
  const { data, error } = useLoad<{ report: StoredReport; editable: boolean }>(`/daily-reports/${id}`);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  if (!data.editable) return <p>This daily report can't be edited: some of its entries are approved, or it was cancelled. Reverse its entries from the Journal instead.</p>;
  return <DailyReport user={user} editing={data.report} />;
}

export default function DailyReport({ user, editing }: { user: AppUser; editing?: StoredReport }) {
  const navigate = useNavigate();
  const pcs = user.profitCenters.filter((p): p is "GGC" | "The Nest" => p === "GGC" || p === "The Nest");
  const e = editing;
  const d = e?.drawer ?? {};
  const [profitCenter, setProfitCenter] = useState<"GGC" | "The Nest">(e?.profit_center ?? pcs[0] ?? "GGC");
  const [businessDate, setBusinessDate] = useState(e?.business_date ?? todayManila());
  const [photos, setPhotos] = useState<Attachment[]>(e?.attachments ?? []);
  const [pos, setPos] = useState<Record<string, Num>>(
    e ? Object.fromEntries(["cash", "card", "gcash", "foodCharges", "refunds", "discounts"].map((k) => [k, str(e.pos[k])])) : {},
  );
  const [discountAccount, setDiscountAccount] = useState(str(e?.pos.discountAccount));
  const [drawer, setDrawer] = useState<Record<string, Num>>(
    e ? { beginning: str(d.beginningPettyCash), actual: str(d.actualCash), remitted: str(d.cashRemitted), nextDay: str(d.nextDayPettyCash) } : {},
  );
  const [cashier, setCashier] = useState<{ id: string; name: string } | null>(
    d.cashierId ? { id: String(d.cashierId), name: String(d.cashierName ?? "") } : null,
  );
  const [paidOuts, setPaidOuts] = useState<PaidOutRow[]>(
    (e?.paid_outs ?? []).map((p) => ({ ...p, amount: str(p.amount), quantity: str(p.quantity), unitPrice: str(p.unitPrice) })),
  );
  const [cashIns, setCashIns] = useState<{ amount: Num; sourceAccount: string; reference: string }[]>(
    (d.cashIns ?? []).map((c) => ({ ...c, amount: str(c.amount), reference: c.reference ?? "" })),
  );
  const [foodCharges, setFoodCharges] = useState<{ employeeId: string; employeeName: string; amount: Num }[]>(
    (e?.food_charges ?? []).map((f) => ({ employeeId: f.employeeId, employeeName: f.employeeName, amount: str(f.amount) })),
  );
  const [notes, setNotes] = useState(e?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const accountList = useAccounts();
  const accounts = useMemo(() => new Map(accountList.map((a) => [a.code, a])), [accountList]);
  const employees = useEmployees(profitCenter);
  const owners = useParties().filter((p) => p.type === "Owner" && p.active);
  const cash = cashAccountsFor(profitCenter);

  const netCents = POS_FIELDS.reduce((t, [k]) => t + toCents(Number(pos[k]) || 0), 0);
  const grossCents = netCents + toCents(Number(pos.refunds) || 0) + toCents(Number(pos.discounts) || 0);
  const input: DailyReportInput = {
    businessDate,
    profitCenter,
    pos: {
      gross: grossCents / 100,
      refunds: +pos.refunds || 0,
      discounts: +pos.discounts || 0,
      net: netCents / 100,
      cash: +pos.cash || 0,
      card: +pos.card || 0,
      gcash: +pos.gcash || 0,
      foodCharges: +pos.foodCharges || 0,
    },
    discountAccount: discountAccount || null,
    drawer: {
      beginningPettyCash: +drawer.beginning || 0,
      actualCash: +drawer.actual || 0,
      cashRemitted: +drawer.remitted || 0,
      nextDayPettyCash: +drawer.nextDay || 0,
      cashierId: cashier?.id ?? null,
      cashierName: cashier?.name ?? null,
    },
    cashIns: cashIns.map((c) => ({ ...c, amount: +c.amount || 0 })),
    paidOuts: paidOuts.map((p) => ({
      ...p,
      amount: +p.amount || 0,
      quantity: p.quantity === "" ? null : +p.quantity,
      unitPrice: p.unitPrice === "" ? null : +p.unitPrice,
    })),
    foodCharges: foodCharges.map((f) => ({ ...f, amount: +f.amount || 0, owner: owners.some((o) => o.id === f.employeeId) })),
    attachments: photos,
    notes,
  };
  const result = accountList.length ? buildDailyReport(input, accounts) : null;
  const f = result?.figures;

  const setPaidOut = (i: number, patch: Partial<PaidOutRow>) =>
    setPaidOuts((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function submit() {
    setBusy(true);
    setServerError(null);
    try {
      if (editing) await api(`/daily-reports/${editing.id}`, { method: "PUT", body: JSON.stringify(input) });
      else await api("/daily-reports", { method: "POST", body: JSON.stringify(input) });
      navigate("/daily-reports");
    } catch (e) {
      setServerError(e instanceof Error ? e.message : "Could not save");
    }
    setBusy(false);
  }

  return (
    <section className="form-page">
      <h1>{editing ? `Edit daily report: ${editing.profit_center}, ${editing.business_date}` : "Daily cashier report"}</h1>
      {editing && <p className="muted">Saving replaces the report and its entries with these figures and sends them for approval again.</p>}

      <div className="card grid2">
        <label>
          Business date (the trading day)
          <input type="date" value={businessDate} min={GO_LIVE_DATE} max={todayManila()} onChange={(e) => setBusinessDate(e.target.value)} />
        </label>
        <label>
          Profit center
          <select value={profitCenter} onChange={(e) => setProfitCenter(e.target.value as "GGC" | "The Nest")} disabled={pcs.length < 2}>
            {pcs.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <div className="span2">
          <span className="label">Photos of the POS slips and the handwritten cash report</span>
          <AttachmentPicker value={photos} onChange={setPhotos} multiple label="Add photos" />
        </div>
      </div>

      <div className="card">
        <h2>1. POS sales summary</h2>
        <h3>Paid by</h3>
        <p className="muted small">Enter what the POS shows per payment type. Net and gross sales are worked out for you. Leave out Grab and Foodpanda: their sales are recorded when the platform pays out (#8 Grab / Foodpanda Payout).</p>
        <div className="grid3">
          {POS_FIELDS.map(([k, label]) => (
            <label key={k}>
              {label}
              <MoneyInput value={pos[k]} onChange={(v) => setPos({ ...pos, [k]: v })} />
            </label>
          ))}
          <Readout label="Net sales (total of the above)" cents={netCents} />
        </div>
        <h3>Add back</h3>
        <div className="grid3">
          {(
            [
              ["refunds", "Refunds"],
              ["discounts", "Discounts"],
            ] as const
          ).map(([k, label]) => (
            <label key={k}>
              {label}
              <MoneyInput value={pos[k]} onChange={(v) => setPos({ ...pos, [k]: v })} />
            </label>
          ))}
          <Readout label="Gross sales (net + refunds + discounts)" cents={grossCents} />
        </div>
        {toCents(pos.discounts) > 0 && (
          <label className="inline">
            Discounts are
            <select value={discountAccount} onChange={(e) => setDiscountAccount(e.target.value)}>
              <option value="">Choose…</option>
              <option value="4181">SC/PWD</option>
              <option value="4182">Promo</option>
            </select>
          </label>
        )}
      </div>

      <div className="card">
        <h2>2. Paid out of the drawer</h2>
        {paidOuts.map((p, i) => {
          const account = p.accountCode ? accounts.get(p.accountCode) : undefined;
          return (
            <div key={i} className="row-card">
              <div className="grid4">
                <label>
                  Type
                  <select value={p.kind} onChange={(e) => setPaidOut(i, { kind: e.target.value as PaidOut["kind"] })}>
                    <option value="expense">Expense / purchase</option>
                    <option value="advance">Employee cash advance</option>
                    <option value="cashout">Cash out (sent to our GCash, cash taken from the drawer)</option>
                    <option value="cardRefund">Card refund paid in cash (paid by card, refunded from the drawer)</option>
                    <option value="unclassified">Not sure (classify later)</option>
                  </select>
                </label>
                <label>
                  Description
                  <input value={p.description} onChange={(e) => setPaidOut(i, { description: e.target.value })} />
                </label>
                <label>
                  Amount
                  <MoneyInput value={p.amount} onChange={(v) => setPaidOut(i, { amount: v })} />
                </label>
                {p.kind === "expense" && (
                  <label>
                    Expense line
                    <ExpenseAccountSelect
                      accounts={accountList}
                      profitCenter={profitCenter}
                      value={p.accountCode}
                      onChange={(code) => setPaidOut(i, { accountCode: code })}
                    />
                  </label>
                )}
                {p.kind === "advance" && (
                  <label>
                    Employee
                    <EmployeeSelect
                      employees={employees}
                      value={p.employeeId}
                      onChange={(id, name) => setPaidOut(i, { employeeId: id, employeeName: name })}
                    />
                  </label>
                )}
              </div>
              {p.kind === "expense" && account && needsQuantity(account) && (
                <div className="grid3">
                  <label>
                    Quantity
                    <MoneyInput value={p.quantity} onChange={(v) => setPaidOut(i, { quantity: v })} />
                  </label>
                  <label>
                    Unit
                    <input value={p.unit ?? ""} placeholder="kg, pcs, bag…" onChange={(e) => setPaidOut(i, { unit: e.target.value })} />
                  </label>
                  <label>
                    Unit price
                    <MoneyInput value={p.unitPrice} onChange={(v) => setPaidOut(i, { unitPrice: v })} />
                  </label>
                </div>
              )}
              <div className="row-actions">
                <AttachmentPicker
                  value={p.receipt ? [p.receipt] : []}
                  onChange={(v) => setPaidOut(i, { receipt: v[0] ?? null })}
                  label={
                    p.kind === "advance" ? "Attach signed CA form (optional)" : p.kind === "cashout" ? "Attach GCash screenshot (optional)" : p.kind === "cardRefund" ? "Attach refund slip (optional)" : "Attach receipt (optional)"
                  }
                />
                <button type="button" className="link danger" onClick={() => setPaidOuts(paidOuts.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </div>
            </div>
          );
        })}
        <button type="button" className="secondary" onClick={() => setPaidOuts([...paidOuts, emptyPaidOut()])}>
          + Add paid-out
        </button>
        <p className="total">Total paid out: {formatPeso(f?.paidOutCents ?? 0)}</p>
      </div>

      <div className="card">
        <h2>3. Cash count</h2>
        <div className="grid3">
          <label>
            Beginning petty cash
            <MoneyInput value={drawer.beginning} onChange={(v) => setDrawer({ ...drawer, beginning: v })} />
          </label>
          <Readout label="Cash sales (POS)" cents={toCents(pos.cash)} />
          <Readout label="Total paid out" cents={f?.paidOutCents ?? 0} />
          <Readout label="Expected cash" cents={f?.expectedCashCents ?? 0} />
          <label>
            Actual cash counted
            <MoneyInput value={drawer.actual} onChange={(v) => setDrawer({ ...drawer, actual: v })} />
          </label>
          <div className="readout">
            <span className="label">Short / over</span>
            <strong className={f && f.overShortCents < 0 ? "error" : ""}>
              {f && f.overShortCents !== 0 ? `${f.overShortCents < 0 ? "Short" : "Over"} ${formatPeso(Math.abs(f.overShortCents))}` : "—"}
            </strong>
          </div>
          <label>
            Cash remitted (for deposit)
            <MoneyInput value={drawer.remitted} onChange={(v) => setDrawer({ ...drawer, remitted: v })} />
          </label>
          <label>
            Next-day petty cash
            <MoneyInput value={drawer.nextDay} onChange={(v) => setDrawer({ ...drawer, nextDay: v })} />
          </label>
          {f && f.overShortCents < 0 && (
            <label>
              Cashier responsible for the shortage
              <EmployeeSelect employees={employees} value={cashier?.id} onChange={(id, name) => setCashier(id ? { id, name } : null)} />
            </label>
          )}
        </div>

        <details>
          <summary>Cash put into the drawer ({cashIns.length})</summary>
          {cashIns.map((ci, i) => (
            <div key={i} className="grid4">
              <label>
                Amount
                <MoneyInput value={ci.amount} onChange={(v) => setCashIns(cashIns.map((c, j) => (j === i ? { ...c, amount: v } : c)))} />
              </label>
              <label>
                From
                <select
                  value={ci.sourceAccount}
                  onChange={(e) => setCashIns(cashIns.map((c, j) => (j === i ? { ...c, sourceAccount: e.target.value } : c)))}
                >
                  <option value="">Choose…</option>
                  <option value={cash.forDeposit}>{cash.forDeposit} Cash for deposit</option>
                  {accountList.filter(isBankAccount).map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Reference
                <input
                  value={ci.reference}
                  onChange={(e) => setCashIns(cashIns.map((c, j) => (j === i ? { ...c, reference: e.target.value } : c)))}
                />
              </label>
              <button type="button" className="link danger" onClick={() => setCashIns(cashIns.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="secondary" onClick={() => setCashIns([...cashIns, { amount: "", sourceAccount: "", reference: "" }])}>
            + Add cash in
          </button>
        </details>
      </div>

      {toCents(pos.foodCharges) > 0 && (
        <div className="card">
          <h2>4. Food charges by person</h2>
          <p className="muted">
            Staff food is deducted from their pay. Owner food counts against their ₱3,000 monthly food allowance; anything above it becomes
            money the owner pays back.
          </p>
          {foodCharges.map((fc, i) => (
            <div key={i} className="grid3">
              <label>
                Charged to
                <select
                  value={fc.employeeId}
                  onChange={(e) => {
                    const p = [...employees, ...owners].find((x) => x.id === e.target.value);
                    setFoodCharges(foodCharges.map((x, j) => (j === i ? { ...x, employeeId: p?.id ?? "", employeeName: p?.name ?? "" } : x)));
                  }}
                >
                  <option value="">Choose…</option>
                  <optgroup label="Staff (deducted from pay)">
                    {employees.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                  {owners.length > 0 && (
                    <optgroup label="Owners (food allowance)">
                      {owners.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
              <label>
                Amount (menu price)
                <MoneyInput value={fc.amount} onChange={(v) => setFoodCharges(foodCharges.map((x, j) => (j === i ? { ...x, amount: v } : x)))} />
              </label>
              <button type="button" className="link danger" onClick={() => setFoodCharges(foodCharges.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="secondary"
            onClick={() => setFoodCharges([...foodCharges, { employeeId: "", employeeName: "", amount: "" }])}
          >
            + Add person
          </button>
        </div>
      )}

      <div className="card">
        <label>
          Notes (optional)
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </label>
      </div>

      <div className="card">
        <h2>Entries this report will create</h2>
        {result?.errors.length ? (
          <ul className="errors">
            {result.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}
        {result?.warnings.length ? (
          <ul className="warnings">
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
        {result && <EntryPreview entries={result.entries} accounts={accounts} />}
        {serverError && <p className="error">{serverError}</p>}
        <button disabled={busy || !result || result.errors.length > 0} onClick={submit}>
          {busy ? "Submitting…" : editing ? "Save changes" : "Submit for approval"}
        </button>
      </div>
    </section>
  );
}

function Readout({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="readout">
      <span className="label">{label}</span>
      <strong>{formatPeso(cents)}</strong>
    </div>
  );
}
