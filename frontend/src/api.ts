// Thin API client. The session cookie is HTTP-only; the CSRF token lives in memory only.
import type { LiveState, User } from "./types";

export class ApiError extends Error {
  status: number;
  code: string;
  detail: Record<string, unknown>;
  constructor(status: number, code: string, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

let csrfToken = "";
let lastState: LiveState | null = null;

export function setCsrf(token: string) {
  csrfToken = token;
}

export function rememberState(s: LiveState) {
  lastState = s;
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; }
  catch { throw new ApiError(res.status, "invalid_response", "The server returned an unreadable response. Refresh and try again."); }
  if (!res.ok) {
    const err = body.error ?? {};
    throw new ApiError(res.status, err.code ?? "http_error", err.message ?? `Request failed (${res.status})`, err);
  }
  return body as T;
}

export async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  return parse<T>(res);
}

export async function validateCsv(csv: string): Promise<import("./types").Envelope<import("./types").ImportSummary>> {
  return parse(await fetch("/api/v1/events/validate", {
    method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "text/csv", "X-CSRF-Token": csrfToken },
    body: csv, signal: AbortSignal.timeout(10000),
  }));
}

export async function login(username: string, password: string): Promise<{ user: User; csrf_token: string }> {
  const res = await fetch("/api/v1/session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const out = await parse<{ user: User; csrf_token: string }>(res);
  setCsrf(out.csrf_token);
  return out;
}

export async function logout(): Promise<void> {
  await parse(await fetch("/api/v1/session", { method: "DELETE", credentials: "same-origin", headers: { "X-CSRF-Token": csrfToken }, signal: AbortSignal.timeout(8000) }));
  csrfToken = "";
  lastState = null;
}

export interface MutationResult<R = Record<string, unknown>> {
  result: R;
  run_id: string;
  revision: number;
  as_of: string;
  idempotent_replay?: boolean;
}

function newKey(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Every write carries an idempotency key and the revision the user was looking at.
 * A network retry reuses the same key, so the server applies it at most once.
 */
export async function mutate<R = Record<string, unknown>>(
  path: string,
  body?: unknown,
  opts: { csv?: string } = {},
): Promise<MutationResult<R>> {
  if (!lastState) lastState = await get<LiveState>("/api/v1/state");
  const key = newKey();
  const headers: Record<string, string> = {
    "X-CSRF-Token": csrfToken,
    "Idempotency-Key": key,
    "X-Expected-Run": lastState.run_id,
    "X-Expected-Revision": String(lastState.revision),
  };
  let payload: BodyInit | undefined;
  if (opts.csv !== undefined) {
    headers["Content-Type"] = "text/csv";
    payload = opts.csv;
  } else {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body ?? {});
  }
  const send = () => fetch(path, { method: "POST", credentials: "same-origin", headers, body: payload, signal: AbortSignal.timeout(10000) });
  let res: Response;
  try {
    res = await send();
  } catch {
    res = await send(); // one retry with the same idempotency key
  }
  const out = await parse<MutationResult<R>>(res);
  lastState = { ...(lastState as LiveState), run_id: out.run_id, revision: out.revision, as_of: out.as_of };
  return out;
}

export function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "stale_revision") return "Someone else changed the state. The view has refreshed; review and try again.";
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}
