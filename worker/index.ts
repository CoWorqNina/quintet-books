import { Hono } from "hono";
import type { Period } from "../shared/types";
import { AirtableError, getAccounts } from "./airtable";
import { requireUser } from "./auth";
import type { AppContext } from "./env";
import { serviceClient } from "./supabase";

const app = new Hono<AppContext>().basePath("/api");

app.onError((err, c) => {
  if (err instanceof AirtableError) return c.json({ error: err.message }, err.status as 502 | 503);
  console.error(err);
  return c.json({ error: "Something went wrong on the server" }, 500);
});

app.get("/health", (c) => c.json({ ok: true }));

app.use("/*", requireUser);

app.get("/me", (c) => c.json(c.get("user")));

app.get("/accounts", async (c) => c.json(await getAccounts(c.env)));

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

export default app;
