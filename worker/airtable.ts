import type { Product } from "../shared/templates";
import type { Account, Party } from "../shared/types";
import type { Env } from "./env";

// Airtable allows 5 requests per second per base and answers 429 when exceeded (then blocks
// for 30 seconds). Reads are cached per Worker instance and requests retry briefly on 429.

const API = "https://api.airtable.com/v0";
const CACHE_TTL_MS = 5 * 60 * 1000;

export const TABLES = {
  accounts: "tblmBkqperzEAxWwa",
  parties: "tblg89x5iUorCvTpN",
  transactionTypes: "tblTYOQYyyPLQw2dN",
  templateLines: "tblNu20xBBJdbM6c7",
  judgmentLog: "tbldoKvRYg9uEsu4d",
  commissaryProducts: "tblygMttsmTFToKoG",
} as const;

export interface AirtableRecord<F = Record<string, unknown>> {
  id: string;
  createdTime: string;
  fields: F;
}

export class AirtableError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function airtableFetch(env: Env, path: string, init: RequestInit = {}): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}/${env.AIRTABLE_BASE_ID}/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (res.status === 429 && attempt < 2) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (!res.ok) {
      const body = await res.text();
      throw new AirtableError(
        res.status === 429 ? "Airtable is busy; try again in 30 seconds" : `Airtable ${res.status}: ${body}`,
        res.status === 429 ? 503 : 502,
      );
    }
    return res.json();
  }
}

export async function createRecords<F>(env: Env, table: string, fields: F[]): Promise<AirtableRecord<F>[]> {
  const out: AirtableRecord<F>[] = [];
  for (let i = 0; i < fields.length; i += 10) {
    const page = (await airtableFetch(env, table, {
      method: "POST",
      body: JSON.stringify({ records: fields.slice(i, i + 10).map((f) => ({ fields: f })), typecast: true }),
    })) as { records: AirtableRecord<F>[] };
    out.push(...page.records);
  }
  return out;
}

export async function updateRecord<F>(env: Env, table: string, id: string, fields: Partial<F>): Promise<AirtableRecord<F>> {
  return (await airtableFetch(env, `${table}/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ fields, typecast: true }),
  })) as AirtableRecord<F>;
}

export async function listAll<F>(env: Env, table: string, params: Record<string, string> = {}) {
  const records: AirtableRecord<F>[] = [];
  let offset: string | undefined;
  do {
    const query = new URLSearchParams({ ...params, pageSize: "100", ...(offset ? { offset } : {}) });
    const page = (await airtableFetch(env, `${table}?${query}`)) as {
      records: AirtableRecord<F>[];
      offset?: string;
    };
    records.push(...page.records);
    offset = page.offset;
  } while (offset);
  return records;
}

const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, load: () => Promise<T>, ttlMs = CACHE_TTL_MS): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function deleteRecord(env: Env, table: string, id: string): Promise<void> {
  await airtableFetch(env, `${table}/${id}`, { method: "DELETE" });
}

export function clearCache(prefix = "") {
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
}

export type AccountFields = Partial<{
  Code: string;
  Name: string;
  Type: Account["type"];
  "Normal Balance": "Dr" | "Cr";
  Book: Account["book"];
  "Profit Center Rule": string;
  "Sub-ledger": string;
  "Cash Flow Group": string;
  Statement: Account["statement"];
  "Statement Line": string;
  "Parent Code": string;
  "Is Header": boolean;
  "Is Cash Account": boolean;
  Active: boolean;
  Description: string;
}>;

export function toAccount(record: AirtableRecord<AccountFields>): Account {
  const f = record.fields;
  return {
    id: record.id,
    code: f.Code ?? "",
    name: f.Name ?? "",
    type: f.Type ?? "Header",
    normalBalance: f["Normal Balance"] ?? null,
    book: f.Book ?? null,
    profitCenterRule: f["Profit Center Rule"] ?? null,
    subLedger: f["Sub-ledger"] ?? null,
    cashFlowGroup: f["Cash Flow Group"] ?? null,
    statement: f.Statement ?? (/^[123]/.test(f.Code ?? "") ? "Balance Sheet" : "Income Statement"),
    statementLine: f["Statement Line"] ?? f.Name ?? "",
    parentCode: f["Parent Code"] ?? null,
    isHeader: f["Is Header"] ?? false,
    isCashAccount: f["Is Cash Account"] ?? false,
    active: f.Active ?? false,
    description: f.Description ?? null,
  };
}

export function getAccounts(env: Env): Promise<Account[]> {
  return cached(`accounts:${env.AIRTABLE_BASE_ID}`, async () => {
    const records = await listAll<AccountFields>(env, TABLES.accounts);
    return records.map(toAccount).sort((a, b) => a.code.localeCompare(b.code));
  });
}

type PartyFields = Partial<{
  Name: string;
  Type: Party["type"];
  Books: Party["books"];
  "Profit Center": Party["profitCenter"];
  Active: boolean;
  "Approval Status": "Pending" | "Approved" | "Rejected";
  "Contact Details": string;
  "Payment Terms": string;
  "Items Supplied": string;
  "Added By": string;
}>;

export function toParty(record: AirtableRecord<PartyFields>): Party {
  const f = record.fields;
  return {
    id: record.id,
    name: (f.Name ?? "").trim(),
    type: f.Type ?? "Other",
    books: f.Books ?? [],
    profitCenter: f["Profit Center"] ?? null,
    active: f.Active ?? false,
    // Suppliers need owner approval before use; everyone else is usable once active.
    approved: f.Type === "Supplier" ? f["Approval Status"] === "Approved" : true,
    approvalStatus: f["Approval Status"] ?? null,
    contactDetails: f["Contact Details"] ?? null,
    paymentTerms: f["Payment Terms"] ?? null,
    itemsSupplied: f["Items Supplied"] ?? null,
    addedBy: f["Added By"] ?? null,
  };
}

// People change often, so the list is refreshed every minute.
export function getParties(env: Env): Promise<Party[]> {
  return cached(
    `parties:${env.AIRTABLE_BASE_ID}`,
    async () => {
      const records = await listAll<PartyFields>(env, TABLES.parties);
      return records.map(toParty).filter((p) => p.name).sort((a, b) => a.name.localeCompare(b.name));
    },
    60_000,
  );
}

type ProductFields = Partial<{ Name: string; Unit: string; "COGS Account": string; Active: boolean }>;

export function getProducts(env: Env): Promise<Product[]> {
  return cached(
    `products:${env.AIRTABLE_BASE_ID}`,
    async () => {
      const records = await listAll<ProductFields>(env, TABLES.commissaryProducts);
      return records
        .map((r) => ({
          id: r.id,
          name: (r.fields.Name ?? "").trim(),
          unit: (r.fields.Unit ?? "").trim(),
          cogsAccount: (r.fields["COGS Account"] ?? "").trim(),
          active: r.fields.Active ?? false,
        }))
        .filter((p) => p.name)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    60_000,
  );
}
