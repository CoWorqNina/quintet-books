import type { EntryDraft } from "../../shared/entries";
import { formatPeso, sumCents } from "../../shared/money";
import { TEMPLATE_NAMES } from "../../shared/templates";
import type { Account } from "../../shared/types";

/** Shows the debits and credits an entry will post, before it is submitted. */
export function EntryPreview({ entries, accounts }: { entries: EntryDraft[]; accounts: Map<string, Account> }) {
  if (!entries.length) return <p className="muted">Nothing to post yet.</p>;
  return (
    <div className="previews">
      {entries.map((e, i) => {
        const dr = sumCents(e.lines.map((l) => l.debitCents));
        const cr = sumCents(e.lines.map((l) => l.creditCents));
        return (
          <div key={i} className="preview">
            <div className="preview-head">
              <strong>
                {e.transaction_type === null ? e.kind : `#${e.transaction_type} ${TEMPLATE_NAMES[e.transaction_type]}`}
              </strong>
              <span className="muted">{e.description}</span>
              {e.unsupported && <span className="badge warn">No receipt</span>}
              {dr !== cr && <span className="badge error">Not balanced</span>}
            </div>
            <table className="lines">
              <tbody>
                {e.lines.map((l, j) => (
                  <tr key={j}>
                    <td className={l.creditCents ? "indent" : ""}>
                      {l.account_code} {accounts.get(l.account_code)?.name ?? "?"}
                      {l.party_name && <span className="muted"> · {l.party_name}</span>}
                      {l.profit_center && <span className="muted"> · {l.profit_center}</span>}
                    </td>
                    <td className="num">{l.debitCents ? formatPeso(l.debitCents) : ""}</td>
                    <td className="num">{l.creditCents ? formatPeso(l.creditCents) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
