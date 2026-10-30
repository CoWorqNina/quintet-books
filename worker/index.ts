import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Period } from "../shared/types";
import { isOwner, todayManila } from "./access";
import { AirtableError, getAccounts, getParties } from "./airtable";
import { requireUser } from "./auth";
import { exportLedger, gzipJson, nightlyBackup } from "./backup";
import { forbidden } from "./db";
import type { AppContext, Env } from "./env";
import { attachments } from "./routes/attachments";
import { dailyReports } from "./routes/dailyReports";
import { entries } from "./routes/entries";
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

app.get("/parties", async (c) => {
  const type = c.req.query("type");
  const parties = (await getParties(c.env)).filter((p) => p.active && (!type || p.type === type));
  return c.json(parties);
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
app.route("/entries", entries);

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
