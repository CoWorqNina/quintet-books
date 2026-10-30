import type { Env } from "./env";
import { serviceClient } from "./supabase";

// The Supabase free plan has no downloadable backups, so the app exports the ledger itself:
// nightly into the private "backups" bucket, and on demand for owners to download.

const TABLES: { name: string; order: string }[] = [
  { name: "app_users", order: "id" },
  { name: "periods", order: "key" },
  { name: "daily_reports", order: "id" },
  { name: "entries", order: "id" },
  { name: "entry_lines", order: "id" },
  { name: "account_period_balances", order: "period_key" },
  { name: "audit_log", order: "id" },
];
const PAGE = 1000;

export async function exportLedger(env: Env): Promise<Record<string, unknown>> {
  const db = serviceClient(env);
  const out: Record<string, unknown> = { exported_at: new Date().toISOString(), format: 1 };
  for (const t of TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db.from(t.name).select("*").order(t.order).range(from, from + PAGE - 1);
      if (error) throw new Error(`Backup of ${t.name} failed: ${error.message}`);
      rows.push(...data);
      if (data.length < PAGE) break;
    }
    out[t.name] = rows;
  }
  return out;
}

export async function gzipJson(value: unknown): Promise<ArrayBuffer> {
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export async function nightlyBackup(env: Env): Promise<string> {
  const body = await gzipJson(await exportLedger(env));
  const path = `ledger-${new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)}.json.gz`;
  const { error } = await serviceClient(env)
    .storage.from("backups")
    .upload(path, body, { contentType: "application/gzip", upsert: true });
  if (error) throw new Error(`Backup upload failed: ${error.message}`);
  return path;
}
