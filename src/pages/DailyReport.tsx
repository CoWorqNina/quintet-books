import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cashAccountsFor, isBankAccount, needsQuantity } from "../../shared/accounts";
import { buildDailyReport, type DailyReportInput, NO_RECEIPT_LIMIT_CENTS, type PaidOut } from "../../shared/dailyReport";
import type { Attachment } from "../../shared/entries";
import { formatPeso, toCents } from "../../shared/money";
import type { AppUser } from "../../shared/types";
import { GO_LIVE_DATE } from "../../shared/config";
import { EntryPreview } from "../components/EntryPreview";
import { AttachmentPicker, EmployeeSelect, ExpenseAccountSelect, MoneyInput } from "../components/inputs";
import { api } from "../lib/api";
import { todayManila, useAccounts, useEmployees } from "../lib/data";

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
  ["grab", "Grab"],
  ["foodpanda", "Foodpanda"],
  ["foodCharges", "Food charges"],
] as const;

export default function DailyReport({ user }: { user: AppUser }) {
  const navigate = useNavigate();
  const pcs = user.profitCenters.filter((p): p is "GGC" | "The Nest" => p === "GGC" || p === "The Nest");
  const [profitCenter, setProfitCenter] = useState<"GGC" | "The Nest">(pcs[0] ?? "GGC");
  const [businessDate, setBusinessDate] = useState(todayManila());
  const [photos, setPhotos] = useState<Attachment[]>([]);
  const [pos, setPos] = useState<Record<string, Num>>({});
  const [discountAccount, setDiscountAccount] = useState("");
  const [drawer, setDrawer] = useState<Record<string, Num>>({});
  const [cashier, setCashier] = useState<{ id: string; name: string } | null>(null);
  const [paidOuts, setPaidOuts] = useState<PaidOutRow[]>([]);
  const [cashIns, setCashIns] = useState<{ amount: Num; sourceAccount: string; reference: string }[]>([]);
  const [foodCharges, setFoodCharges] = useState<{ employeeId: string; employeeName: string; amount: Num }[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const accountList = useAccounts();
  const accounts = useMemo(() => new Map(accountList.map((a) => [a.code, a])), [accountList]);
  const employees = useEmployees(profitCenter);
  const cash = cashAccountsFor(profitCenter);

  const input: DailyReportInput = {
    businessDate,
    profitCenter,
    pos: {
      gross: +pos.gross || 0,
      refunds: +pos.refunds || 0,
      discounts: +pos.discounts || 0,
      net: +pos.net || 0,
      cash: +pos.cash || 0,
      card: +pos.card || 0,
      gcash: +pos.gcash || 0,
      grab: +pos.grab || 0,
      foodpanda: +pos.foodpanda || 0,
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
    foodCharges: foodCharges.map((f) => ({ ...f, amount: +f.amount || 0 })),
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
      await api("/daily-reports", { method: "POST", body: JSON.stringify(input) });
      navigate("/daily-reports");
    } catch (e) {
      setServerError(e instanceof Error ? e.message : "Could not save");
    }
    setBusy(false);
  }

  return (
    <section className="form-page">
      <h1>Daily cashier report</h1>

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
        <div className="grid4">
          {(
            [
              ["gross", "Gross sales"],
              ["refunds", "Refunds"],
              ["discounts", "Discounts"],
              ["net", "Net sales"],
            ] as const
          ).map(([k, label]) => (
            <label key={k}>
              {label}
              <MoneyInput value={pos[k]} onChange={(v) => setPos({ ...pos, [k]: v })} />
            </label>
          ))}
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
        <h3>Paid by</h3>
        <div className="grid3">
          {POS_FIELDS.map(([k, label]) => (
            <label key={k}>
              {label}
              <MoneyInput value={pos[k]} onChange={(v) => setPos({ ...pos, [k]: v })} />
            </label>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>2. Paid out of the drawer</h2>
        {paidOuts.map((p, i) => {
          const account = p.accountCode ? accounts.get(p.accountCode) : undefined;
          const small = toCents(p.amount) > 0 && toCents(p.amount) <= NO_RECEIPT_LIMIT_CENTS;
          return (
            <div key={i} className="row-card">
              <div className="grid4">
                <label>
                  Type
                  <select value={p.kind} onChange={(e) => setPaidOut(i, { kind: e.target.value as PaidOut["kind"] })}>
                    <option value="expense">Expense / purchase</option>
                    <option value="advance">Employee cash advance</option>
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
                  label={p.kind === "advance" ? "Attach signed acknowledgment" : "Attach receipt"}
                />
                {p.kind === "expense" && !p.receipt && small && (
                  <label className="inline">
                    <input
                      type="checkbox"
                      checked={!!p.noReceiptApproved}
                      onChange={(e) => setPaidOut(i, { noReceiptApproved: e.target.checked })}
                    />
                    No receipt, approved by Supervisor
                  </label>
                )}
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
          <h2>4. Food charges by employee</h2>
          {foodCharges.map((fc, i) => (
            <div key={i} className="grid3">
              <label>
                Employee
                <EmployeeSelect
                  employees={employees}
                  value={fc.employeeId}
                  onChange={(id, name) => setFoodCharges(foodCharges.map((x, j) => (j === i ? { ...x, employeeId: id, employeeName: name } : x)))}
                />
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
            + Add employee
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
          {busy ? "Submitting…" : "Submit for approval"}
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
