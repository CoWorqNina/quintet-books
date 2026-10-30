import type { PostgrestError } from "@supabase/supabase-js";
import { HTTPException } from "hono/http-exception";

// Business-rule errors raised by the ledger functions (errcode P0001) and constraint
// violations are shown to the user; anything else is a server error.
const CONSTRAINT_MESSAGES: Record<string, string> = {
  entries_no_self_approval: "Nobody approves their own entry.",
  entries_reason_required: "This kind of entry needs a written reason.",
  entries_rejection_has_reason: "Rejecting needs a reason.",
  entry_lines_one_side: "Each line is either a debit or a credit.",
  entries_period_matches_date: "The entry date doesn't match its month.",
};

export function dbError(error: PostgrestError | null): never | void {
  if (!error) return;
  if (error.code === "P0001") throw new HTTPException(400, { message: error.message });
  if (error.code === "23514" || error.code === "23505") {
    const known = Object.entries(CONSTRAINT_MESSAGES).find(([name]) => error.message.includes(name));
    throw new HTTPException(400, { message: known ? known[1] : error.message });
  }
  if (error.code === "23503" && error.message.includes("period")) {
    throw new HTTPException(400, { message: "There is no accounting month for that date." });
  }
  console.error("Database error", error);
  throw new HTTPException(500, { message: "Database error" });
}

export function badRequest(message: string): never {
  throw new HTTPException(400, { message });
}

export function forbidden(message = "You don't have access to do that."): never {
  throw new HTTPException(403, { message });
}
