import type { ReactNode } from "react";
import { formatPeso, toCents } from "../../shared/money";
import type { JournalEntry } from "../../shared/types";
import { AttachmentLinks } from "./inputs";

const STATUS_CLASS: Record<JournalEntry["status"], string> = {
  Draft: "",
  Submitted: "info",
  Approved: "ok",
  Rejected: "error",
  Cancelled: "muted-badge",
};

/** One journal entry with its lines; used by the journal and the approval queue. */
export function EntryCard({ entry, actions, select }: { entry: JournalEntry; actions?: ReactNode; select?: ReactNode }) {
  return (
    <div className={`entry-card status-${entry.status.toLowerCase()}`}>
      <div className="entry-head">
        {select}
        <strong>
          {entry.entryDate} · #{entry.id}
        </strong>
        <span>{entry.templateName}</span>
        {entry.profitCenter && <span className="muted">{entry.profitCenter}</span>}
        <span className={`badge ${STATUS_CLASS[entry.status]}`}>{entry.status}</span>
        {entry.unsupported && <span className="badge warn">No receipt</span>}
        <span className="spacer" />
        <strong>{formatPeso(toCents(entry.totalDebit))}</strong>
      </div>
      {entry.description && <div className="entry-desc">{entry.description}</div>}
      <table className="lines">
        <tbody>
          {entry.lines.map((l) => (
            <tr key={l.lineNo}>
              <td className={l.credit ? "indent" : ""}>
                {l.accountCode} {l.accountName}
                {l.partyName && <span className="muted"> · {l.partyName}</span>}
                {l.profitCenter && <span className="muted"> · {l.profitCenter}</span>}
                {l.quantity !== null && (
                  <span className="muted">
                    {" "}
                    · {l.quantity} {l.unit} @ {formatPeso(toCents(l.unitPrice))}
                  </span>
                )}
              </td>
              <td className="num">{l.debit ? formatPeso(toCents(l.debit)) : ""}</td>
              <td className="num">{l.credit ? formatPeso(toCents(l.credit)) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="entry-foot muted">
        By {entry.createdBy}
        {entry.approvedBy && ` · approved by ${entry.approvedBy}`}
        {entry.sourceDocument && ` · ref ${entry.sourceDocument}`}
        {entry.dailyReportId && ` · daily report ${entry.dailyReportId}`}
        {entry.rejectionReason && <span className="error"> · Rejected: {entry.rejectionReason}</span>}
        <AttachmentLinks items={entry.attachments} />
        <span className="spacer" />
        {actions}
      </div>
    </div>
  );
}
