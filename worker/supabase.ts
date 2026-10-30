import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./env";

let cached: { key: string; client: SupabaseClient } | undefined;

// Server-side client with the secret key. It bypasses row-level security, so it must never be
// exposed to the browser; every route checks the caller's role before using it.
export function serviceClient(env: Env): SupabaseClient {
  const key = `${env.SUPABASE_URL}|${env.SUPABASE_SECRET_KEY}`;
  if (cached?.key !== key) {
    cached = {
      key,
      client: createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }),
    };
  }
  return cached.client;
}
