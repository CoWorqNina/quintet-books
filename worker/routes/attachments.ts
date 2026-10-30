import { Hono } from "hono";
import type { Attachment } from "../../shared/entries";
import { badRequest } from "../db";
import type { AppContext } from "../env";
import { serviceClient } from "../supabase";

const TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
const MAX_BYTES = 5 * 1024 * 1024;
const PATH_RE = /^\d{4}\/\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/;

export function isAttachmentPath(path: unknown): path is string {
  return typeof path === "string" && PATH_RE.test(path);
}

/** Keeps only attachment objects that point at files this app uploaded. */
export function cleanAttachments(list: unknown): Attachment[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((a) => a && isAttachmentPath(a.path))
    .map((a) => ({ path: a.path, name: String(a.name ?? "file").slice(0, 200), type: String(a.type ?? ""), size: Number(a.size) || 0 }));
}

export const attachments = new Hono<AppContext>();

// Receipts, POS slips and statements. Photos are shrunk in the browser before upload.
attachments.post("/", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) badRequest("No file uploaded.");
  const ext = TYPES[file.type];
  if (!ext) badRequest("Upload a photo (JPG, PNG, WebP) or a PDF.");
  if (file.size > MAX_BYTES) badRequest("Files must be 5 MB or smaller.");

  const now = new Date();
  const path = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.${ext}`;
  const { error } = await serviceClient(c.env)
    .storage.from("attachments")
    .upload(path, await file.arrayBuffer(), { contentType: file.type });
  if (error) {
    console.error("Upload failed", error);
    badRequest("Upload failed. Please try again.");
  }
  const attachment: Attachment = { path, name: file.name.slice(0, 200), type: file.type, size: file.size };
  return c.json(attachment);
});

// Short-lived link for viewing a file (the bucket itself is private).
attachments.get("/url", async (c) => {
  const path = c.req.query("path");
  if (!isAttachmentPath(path)) badRequest("Unknown file.");
  const { data, error } = await serviceClient(c.env).storage.from("attachments").createSignedUrl(path, 600);
  if (error || !data) badRequest("File not found.");
  return c.json({ url: data.signedUrl });
});
