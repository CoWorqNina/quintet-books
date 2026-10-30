import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Period } from "../shared/types";
import { isOwner, todayManila } from "./access";
import { AirtableError, getAccounts, getProducts } from "./airtable";
import { accountBalanceCents } from "./balances";
import { DUE_TO_COMMISSARY } from "../shared/templates/commissary";
import { getLoans } from "./registers";
import { requireUser } from "./auth";
import { exportLedger, gzipJson, nightlyBackup } from "./backup";
import { forbidden } from "./db";
import type { AppContext, Env } from "./env";
import { adjustments } from "./routes/adjustments";
import { attachments } from "./routes/attachments";
import { dailyReports } from "./routes/dailyReports";
import { entries } from "./routes/entries";
import { parties } from "./routes/parties";
import { setup } from "./routes/setup";
import { serviceClient } from "./supabase";

const app = new Hono<AppContext>().basePath("/api");

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  if (err instanceof AirtableError) return c.json({ error: err.message }, err.status as 502 | 503);
  console.error(err);
  return c.json({ error: "Something went wrong on the server" }, 500);
});

app.get("/health", (c) => c.json({ ok: true }));

app.use("/*", requireUser);

app.get("/me", (c) => c.json(c.get("user")));

app.get("/accounts", async (c) => c.json(await getAccounts(c.env)));

app.get("/products", async (c) => c.json(await getProducts(c.env)));

app.get("/loans", async (c) => c.json(await getLoans(serviceClient(c.env))));

// What the Store owes the Commissary (approved entries), for the monthly settlement.
app.get("/balances/due-to-commissary", async (c) => {
  const user = c.get("user");
  if (!["Owner", "Accountant"].includes(user.role)) forbidden();
  return c.json({ cents: -(await accountBalanceCents(serviceClient(c.env), "Store", DUE_TO_COMMISSARY)) });
});

app.get("/periods", async (c) => {
  const { data, error } = await serviceClient(c.env)
    .from("periods")
    .select("key, start_date, end_date, status")
    .order("key");
  if (error) throw error;
  const periods: Period[] = data.map((p) => ({
    key: p.key,
    startDate: p.start_date,
    endDate: p.end_date,
    status: p.status,
  }));
  return c.json(periods);
});

app.route("/attachments", attachments);
app.route("/daily-reports", dailyReports);
app.route("/entries", adjustments);
app.route("/entries", entries);
app.route("/parties", parties);
app.route("/", setup);

// Owners can download the whole ledger at any time.
app.get("/backup", async (c) => {
  if (!isOwner(c.get("user"))) forbidden("Only owners can download backups.");
  const body = await gzipJson(await exportLedger(c.env));
  return new Response(body, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="ggc-books-ledger-${todayManila()}.json.gz"`,
    },
  });
});

export default {
  fetch: app.fetch,
  // Nightly ledger backup (see "triggers" in wrangler.jsonc).
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(nightlyBackup(env).then((path) => console.log(`Backup saved: ${path}`)));
  },
} satisfies ExportedHandler<Env>;
