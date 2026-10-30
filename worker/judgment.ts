import { createRecords, TABLES } from "./airtable";
import type { Env } from "./env";
import { todayManila } from "./access";

export type JudgmentCategory = "New account" | "New supplier" | "New template" | "Reclassification" | "Policy decision" | "Other";

/** Adds a row to the Adjustments & Judgment Log in Airtable. */
export async function logJudgment(
  env: Env,
  entry: { category: JudgmentCategory; description: string; decidedBy: string; recordedBy: string },
) {
  await createRecords(env, TABLES.judgmentLog, [
    {
      Date: todayManila(),
      Category: entry.category,
      Description: entry.description,
      "Decided By": entry.decidedBy,
      "Recorded By": entry.recordedBy,
    },
  ]);
}
