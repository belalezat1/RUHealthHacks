import type {
  Audit,
  Dashboard,
  DecisionAction,
  EventResult,
  EventPage,
  ImportResult,
  PreviewMethod,
  DatasetExample,
  EventInput,
  Forecast,
  Physician,
  Recommendation,
  Scenario,
  Simulation,
  Validation,
} from "./types";

const BASE = import.meta.env.VITE_API_BASE_URL || "/v1";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export const isNoDataset = (error: unknown) =>
  error instanceof ApiError &&
  error.status === 409 &&
  error.message.startsWith("No active dataset");

export type Actor = {
  role: "dispatcher" | "admin" | "physician" | "evaluator";
  id: string;
};
const dispatcher: Actor = { role: "dispatcher", id: "demo-dispatcher" };
const admin: Actor = { role: "admin", id: "demo-admin" };
const evaluator: Actor = { role: "evaluator", id: "demo-evaluator" };
export async function request<T>(
  path: string,
  options: { body?: unknown; actor?: Actor; signal?: AbortSignal } = {},
): Promise<T> {
  const actor = options.actor ?? dispatcher;
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: options.body === undefined ? "GET" : "POST",
      signal: options.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Demo-Role": actor.role,
        "X-Demo-Actor": actor.id,
        ...(options.body !== undefined
          ? { "Idempotency-Key": crypto.randomUUID() }
          : {}),
      },
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new ApiError(
      0,
      "Connection unavailable. Check that the API is running, then retry.",
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail ?? "The request could not be completed.";
    throw new ApiError(
      response.status,
      typeof detail === "string" ? detail : JSON.stringify(detail),
    );
  }
  return data as T;
}
export const api = {
  dashboard: (signal?: AbortSignal) =>
    request<Dashboard>("/dashboard", { signal }),
  physicians: (signal?: AbortSignal) =>
    request<Physician[]>("/physicians", { signal }),
  forecast: (signal?: AbortSignal) =>
    request<Forecast>("/coverage/forecast", { signal }),
  examples: () => request<DatasetExample[]>("/datasets/examples"),
  validate: (dataset: unknown) =>
    request<Validation>("/datasets/validate", { body: dataset, actor: admin }),
  import: (dataset: unknown) =>
    request<ImportResult>("/datasets/import", { body: dataset, actor: admin }),
  event: (event: EventInput) =>
    request<EventResult>("/events", { body: event, actor: evaluator }),
  events: (offset = 0) =>
    request<EventPage>(`/events?offset=${offset}&limit=15`),
  preview: (consultation_id: string, method: PreviewMethod) =>
    request<Recommendation>("/optimizations/preview", {
      body: { consultation_id, method },
    }),
  recommendation: (id: string, signal?: AbortSignal) =>
    request<Recommendation>(`/recommendations/${encodeURIComponent(id)}`, {
      signal,
    }),
  decision: (
    id: string,
    action: DecisionAction,
    body: Record<string, unknown>,
    actor?: Actor,
  ) =>
    request<Recommendation>(
      `/recommendations/${encodeURIComponent(id)}/${action}`,
      { body, actor },
    ),
  audit: (offset = 0) =>
    request<{ items: Audit[]; total: number }>(
      `/audit?offset=${offset}&limit=15`,
    ),
  scenarios: () => request<Scenario[]>("/simulations/scenarios"),
  simulate: (scenario: string, seed: number) =>
    request<Simulation>("/simulations", {
      body: { scenario, seed },
      actor: evaluator,
    }),
};
