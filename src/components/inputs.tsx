import { useState } from "react";
import { isExpenseAccount } from "../../shared/accounts";
import type { Attachment } from "../../shared/entries";
import type { Account, Party } from "../../shared/types";
import { api, ApiRequestError } from "../lib/api";
import { supabase } from "../lib/supabase";

export function MoneyInput({
  value,
  onChange,
  ...rest
}: { value: number | string | null | undefined; onChange: (v: string) => void } & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
>) {
  return (
    <input
      inputMode="decimal"
      className="money"
      placeholder="0.00"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
      {...rest}
    />
  );
}

export function EmployeeSelect({
  employees,
  value,
  onChange,
}: {
  employees: Party[];
  value: string | null | undefined;
  onChange: (id: string, name: string) => void;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value, employees.find((p) => p.id === e.target.value)?.name ?? "")}
    >
      <option value="">{employees.length ? "Choose employee…" : "No employees in Airtable yet"}</option>
      {employees.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

export function ExpenseAccountSelect({
  accounts,
  profitCenter,
  value,
  onChange,
}: {
  accounts: Account[];
  profitCenter: string;
  value: string | undefined;
  onChange: (code: string) => void;
}) {
  const options = accounts.filter(
    (a) =>
      isExpenseAccount(a) &&
      (a.book === "Store" || a.book === "Both") &&
      (a.profitCenterRule !== "The Nest" || profitCenter === "The Nest") &&
      (a.profitCenterRule !== "GGC" || profitCenter === "GGC"),
  );
  const groups = [...new Set(options.map((a) => a.statementLine))];
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose expense line…</option>
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

/** Shrinks photos to at most 1600 px and re-encodes as JPEG so uploads stay small. */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.75));
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}

export async function uploadFile(file: File): Promise<Attachment> {
  const form = new FormData();
  form.append("file", await shrink(file));
  const { data } = await supabase.auth.getSession();
  const res = await fetch("/api/attachments", {
    method: "POST",
    headers: data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {},
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiRequestError(body.error ?? "Upload failed", res.status);
  return body as Attachment;
}

export async function openAttachment(a: Attachment) {
  const { url } = await api<{ url: string }>(`/attachments/url?path=${encodeURIComponent(a.path)}`);
  window.open(url, "_blank", "noopener");
}

export function AttachmentLinks({ items }: { items: Attachment[] }) {
  if (!items.length) return null;
  return (
    <span className="attachments">
      {items.map((a) => (
        <button key={a.path} type="button" className="link" onClick={() => openAttachment(a)}>
          📎 {a.name}
        </button>
      ))}
    </span>
  );
}

/** Upload button for one file (multiple = false) or several. */
export function AttachmentPicker({
  value,
  onChange,
  multiple = false,
  label = "Attach photo",
}: {
  value: Attachment[];
  onChange: (v: Attachment[]) => void;
  multiple?: boolean;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      const uploaded = [];
      for (const f of Array.from(files)) uploaded.push(await uploadFile(f));
      onChange(multiple ? [...value, ...uploaded] : uploaded.slice(0, 1));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    }
    setBusy(false);
  }

  return (
    <span className="picker">
      {value.map((a) => (
        <span key={a.path} className="chip">
          <button type="button" className="link" onClick={() => openAttachment(a)}>
            📎 {a.name}
          </button>
          <button type="button" className="link danger" onClick={() => onChange(value.filter((x) => x.path !== a.path))}>
            ✕
          </button>
        </span>
      ))}
      {(multiple || !value.length) && (
        <label className="upload">
          {busy ? "Uploading…" : label}
          <input
            type="file"
            accept="image/*,application/pdf"
            capture={undefined}
            multiple={multiple}
            disabled={busy}
            onChange={(e) => {
              pick(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      )}
      {error && <span className="error">{error}</span>}
    </span>
  );
}
