import { Hono } from "hono";
import type { Role } from "../../shared/types";
import { isOwner } from "../access";
import { badRequest, dbError, forbidden } from "../db";
import type { AppContext } from "../env";
import { serviceClient } from "../supabase";

// Owners manage who can sign in and what each person sees. Every change is in the audit log.
export const users = new Hono<AppContext>();

const ROLES: Role[] = ["Owner", "Accountant", "Supervisor", "Staff", "Commissary In-charge"];
type Access = { fullName?: string; role?: Role; books?: string[]; profitCenters?: string[]; active?: boolean };

users.use("/*", async (c, next) => {
  if (!isOwner(c.get("user"))) forbidden("Only an Owner manages users.");
  await next();
});

function checkAccess(a: Access) {
  if (a.role !== undefined && !ROLES.includes(a.role)) badRequest("Choose a role.");
  if (a.books !== undefined && (!a.books.length || a.books.some((b) => b !== "Store" && b !== "Commissary"))) badRequest("Choose at least one book.");
  if (a.profitCenters !== undefined && (!a.profitCenters.length || a.profitCenters.some((p) => p !== "GGC" && p !== "The Nest"))) badRequest("Choose at least one profit center.");
  if (a.fullName !== undefined && !a.fullName.trim()) badRequest("Enter the person's name.");
}

const columns = (a: Access) => ({
  ...(a.fullName !== undefined && { full_name: a.fullName.trim() }),
  ...(a.role !== undefined && { role: a.role }),
  ...(a.books !== undefined && { books: a.books }),
  ...(a.profitCenters !== undefined && { profit_centers: a.profitCenters }),
  ...(a.active !== undefined && { active: a.active }),
});

users.get("/", async (c) => {
  const { data, error } = await serviceClient(c.env).from("app_users").select("id, email, full_name, role, books, profit_centers, active, created_at").order("full_name");
  dbError(error);
  return c.json(
    (data ?? []).map((u) => ({ id: u.id, email: u.email, fullName: u.full_name, role: u.role, books: u.books, profitCenters: u.profit_centers, active: u.active, createdAt: u.created_at })),
  );
});

// Invite by email: Supabase sends a link to set a password; the person appears here right away.
users.post("/", async (c) => {
  const me = c.get("user");
  const body = await c.req.json<Access & { email?: string }>();
  const email = body.email?.trim().toLowerCase() ?? "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) badRequest("Enter a valid email.");
  checkAccess({ ...body, fullName: body.fullName ?? "" });
  if (!body.role || !body.books || !body.profitCenters) badRequest("Choose the role, books and profit centers.");
  const db = serviceClient(c.env);
  const { data: existing } = await db.from("app_users").select("id").eq("email", email).maybeSingle();
  if (existing) badRequest("This person is already set up.");
  const origin = new URL(c.req.url).origin;
  const { data: invited, error: inviteError } = await db.auth.admin.inviteUserByEmail(email, { redirectTo: origin });
  if (inviteError || !invited.user) badRequest(inviteError?.message ?? "Could not send the invitation.");
  const { error } = await db.from("app_users").insert({ id: invited.user.id, email, active: true, ...columns(body) });
  dbError(error);
  dbError((await db.from("audit_log").insert({ user_id: me.id, action: "Invite", entity: "user", entity_id: invited.user.id, details: { email, ...columns(body) } })).error);
  return c.json({ ok: true });
});

users.patch("/:id", async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json<Access>();
  checkAccess(body);
  const db = serviceClient(c.env);
  if (id === me.id && ((body.role && body.role !== "Owner") || body.active === false)) badRequest("You can't remove your own Owner access. Ask the other Owner.");
  if ((body.role && body.role !== "Owner") || body.active === false) {
    const { data: owners, error } = await db.from("app_users").select("id").eq("role", "Owner").eq("active", true);
    dbError(error);
    if ((owners ?? []).filter((o) => o.id !== id).length === 0) badRequest("At least one active Owner is needed.");
  }
  const { error } = await db.from("app_users").update(columns(body)).eq("id", id);
  dbError(error);
  dbError((await db.from("audit_log").insert({ user_id: me.id, action: "Change access", entity: "user", entity_id: id, details: columns(body) })).error);
  return c.json({ ok: true });
});
