import { supabase } from "./supabase";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiRequestError(body.error ?? `Request failed (${res.status})`, res.status, body);
  return body as T;
}

export const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
