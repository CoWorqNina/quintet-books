import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { looksSimilar } from "../../shared/similar";
import type { Party, Role } from "../../shared/types";
import { isOwner } from "../access";
import { clearCache, createRecords, getParties, TABLES, updateRecord } from "../airtable";
import { badRequest, forbidden } from "../db";
import type { AppContext } from "../env";
import { logJudgment } from "../judgment";

export const parties = new Hono<AppContext>();

const CAN_ADD: Record<Party["type"], Role[]> = {
  Supplier: ["Owner", "Accountant", "Supervisor", "Commissary In-charge"],
  Employee: ["Owner", "Accountant"],
  Owner: ["Owner"],
  Lender: ["Owner", "Accountant"],
  Platform: ["Owner", "Accountant"],
  Other: ["Owner", "Accountant"],
};

parties.get("/", async (c) => {
  const user = c.get("user");
  const type = c.req.query("type");
  const all = c.req.query("all") === "1" && ["Owner", "Accountant", "Supervisor", "Commissary In-charge"].includes(user.role);
  const list = (await getParties(c.env)).filter((p) => (all || p.active) && (!type || p.type === type));
  return c.json(list);
});

interface NewParty {
  name: string;
  type: Party["type"];
  books?: Party["books"];
  profitCenter?: Party["profitCenter"];
  contactDetails?: string;
  paymentTerms?: string;
  itemsSupplied?: string;
  confirmDuplicate?: boolean;
}

parties.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<NewParty>();
  const name = body.name?.trim();
  if (!name) badRequest("Enter a name.");
  if (!CAN_ADD[body.type]) badRequest("Choose a type.");
  if (!CAN_ADD[body.type].includes(user.role)) forbidden(`Your role can't add ${body.type.toLowerCase()}s.`);
  if (body.type === "Supplier" && !body.paymentTerms?.trim()) badRequest("Enter the supplier's payment terms (e.g. COD, 15 days).");

  const existing = await getParties(c.env);
  const similar = existing.filter((p) => p.type === body.type && looksSimilar(p.name, name));
  if (similar.length && !body.confirmDuplicate) {
    return c.json({ duplicates: similar.map((p) => ({ id: p.id, name: p.name, active: p.active })) }, 409);
  }

  const autoApproved = body.type !== "Supplier" || isOwner(user);
  const [record] = await createRecords(c.env, TABLES.parties, [
    {
      Name: name,
      Type: body.type,
      Books: body.books?.length ? body.books : ["Store"],
      "Profit Center": body.profitCenter ?? undefined,
      "Contact Details": body.contactDetails?.trim() || undefined,
      "Payment Terms": body.paymentTerms?.trim() || undefined,
      "Items Supplied": body.itemsSupplied?.trim() || undefined,
      "Approval Status": body.type === "Supplier" ? (autoApproved ? "Approved" : "Pending") : undefined,
      "Approved By": body.type === "Supplier" && autoApproved ? user.fullName : undefined,
      Active: true,
      "Added By": user.fullName,
      "Added At": new Date().toISOString(),
      Notes: similar.length ? `Possible duplicate of: ${similar.map((p) => p.name).join(", ")}` : undefined,
    },
  ]);
  clearCache("parties");
  if (body.type === "Supplier") {
    await logJudgment(c.env, {
      category: "New supplier",
      description: `Added supplier ${name}${autoApproved ? " (approved)" : " (waiting for owner approval)"}${similar.length ? `; possible duplicate of ${similar.map((p) => p.name).join(", ")}` : ""}.`,
      decidedBy: autoApproved ? user.fullName : "Pending",
      recordedBy: user.fullName,
    });
  }
  return c.json({ id: record.id, approved: autoApproved });
});

// Owners approve or reject suppliers added by others.
parties.post("/:id/approval", async (c) => {
  const user = c.get("user");
  if (!isOwner(user)) forbidden("Only owners approve suppliers.");
  const { approve } = await c.req.json<{ approve: boolean }>();
  const party = (await getParties(c.env)).find((p) => p.id === c.req.param("id"));
  if (!party || party.type !== "Supplier") throw new HTTPException(404, { message: "Supplier not found." });
  await updateRecord(c.env, TABLES.parties, party.id, {
    "Approval Status": approve ? "Approved" : "Rejected",
    "Approved By": user.fullName,
    ...(approve ? {} : { Active: false }),
  });
  clearCache("parties");
  await logJudgment(c.env, {
    category: "New supplier",
    description: `${approve ? "Approved" : "Rejected"} supplier ${party.name}.`,
    decidedBy: user.fullName,
    recordedBy: user.fullName,
  });
  return c.json({ ok: true });
});

// Deactivate / reactivate (never delete: parties may have postings).
parties.post("/:id/active", async (c) => {
  const user = c.get("user");
  if (!["Owner", "Accountant"].includes(user.role)) forbidden();
  const { active } = await c.req.json<{ active: boolean }>();
  await updateRecord(c.env, TABLES.parties, c.req.param("id"), { Active: active });
  clearCache("parties");
  return c.json({ ok: true });
});
