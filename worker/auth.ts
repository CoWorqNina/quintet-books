import { createMiddleware } from "hono/factory";
import type { AppUser } from "../shared/types";
import type { AppContext } from "./env";
import { serviceClient } from "./supabase";

export function bearerToken(header: string | undefined): string | null {
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

// Verifies the Supabase access token and loads the caller's role and access from app_users.
// A valid login without an active app_users row gets 403: the person must be set up by an owner.
export const requireUser = createMiddleware<AppContext>(async (c, next) => {
  const token = bearerToken(c.req.header("Authorization"));
  if (!token) return c.json({ error: "Not signed in" }, 401);

  const supabase = serviceClient(c.env);
  const { data: claims, error } = await supabase.auth.getClaims(token);
  const userId = claims?.claims?.sub;
  if (error || !userId) return c.json({ error: "Your session has expired. Please sign in again." }, 401);

  const { data: row, error: dbError } = await supabase
    .from("app_users")
    .select("id, email, full_name, role, books, profit_centers, active")
    .eq("id", userId)
    .maybeSingle();
  if (dbError) return c.json({ error: "Could not load your account" }, 500);
  if (!row || !row.active) {
    return c.json({ error: "Your login is not set up in GGC Books yet. Ask Nina or Kai to add you." }, 403);
  }

  const user: AppUser = {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    books: row.books,
    profitCenters: row.profit_centers,
  };
  c.set("user", user);
  await next();
});
