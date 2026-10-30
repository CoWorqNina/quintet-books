import type { AppUser } from "../shared/types";

export interface Env {
  ASSETS: Fetcher;
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;
  AIRTABLE_BASE_ID: string;
  AIRTABLE_TOKEN: string;
}

export type AppContext = { Bindings: Env; Variables: { user: AppUser } };
