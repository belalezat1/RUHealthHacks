import type { ReactNode } from "react";
import { ApiError } from "../api/client";
import type { Tone } from "../api/types";
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    overview: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    chart: (
      <>
        <path d="M3 3v18h18M6 15l4-5 4 3 6-8" />
      </>
    ),
    people: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 21v-3a6 6 0 0112 0v3M16 5a3 3 0 010 6M18 15a5 5 0 013 4v2" />
      </>
    ),
    queue: (
      <>
        <rect x="5" y="4" width="14" height="18" rx="2" />
        <path d="M9 4V2h6v2M9 10h6M9 14h6M9 18h4" />
      </>
    ),
    spark: (
      <>
        <path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3z" />
      </>
    ),
    flask: (
      <>
        <path d="M9 3h6M10 3v7L4 20a1 1 0 001 1h14a1 1 0 001-1l-6-10V3M8 15h8" />
      </>
    ),
    arrow: (
      <>
        <path d="M5 12h14M13 6l6 6-6 6" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0112-2l2 3M4 16l2 3a7 7 0 0012-2" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    check: <path d="M5 12l4 4L19 6" />,
    alert: (
      <>
        <path d="M12 3L2 21h20L12 3zM12 9v5M12 17h.01" />
      </>
    ),
    close: <path d="M6 6l12 12M6 18L18 6" />,
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="M15 15l6 6" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12M7 10l5 5 5-5M4 17v4h16v-4" />
      </>
    ),
    database: (
      <>
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0" />
      </>
    ),
    shield: (
      <>
        <path d="M12 2l8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4zM8 12l3 3 5-6" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.overview}
    </svg>
  );
}
export function Badge({
  children,
  tone = "gray",
  dot = false,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
}) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot && <i />}
      {children}
    </span>
  );
}
export function tone(status?: string): Tone {
  if (!status) return "gray";
  if (
    [
      "eligible",
      "available",
      "verified",
      "pass",
      "completed",
      "connected",
      "active",
      "applied",
      "accepted",
      "physician_accepted",
    ].includes(status)
  )
    return "green";
  if (
    [
      "ineligible",
      "critical",
      "high",
      "urgent",
      "fail",
      "failed",
      "declined",
      "rejected",
      "unavailable",
      "disconnected",
    ].includes(status)
  )
    return "red";
  if (
    [
      "unverified",
      "unknown",
      "warning",
      "medium",
      "stale",
      "expired",
      "busy",
      "approved_for_contact",
    ].includes(status)
  )
    return "amber";
  return "blue";
}
export function human(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value.replaceAll("_", " ");
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
export const time = (value?: string | null) =>
  value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "—";
export const datetime = (value?: string | null) =>
  value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(value))
    : "—";
export function PageHeading({
  eyebrow = "OPERATIONS WORKSPACE",
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}
export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="panel-heading">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name="database" size={25} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function ErrorNotice({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  if (!error) return null;
  const conflict = error instanceof ApiError && error.status === 409;
  return (
    <div className="notice notice-error" role="alert">
      <Icon name="alert" />
      <div>
        <strong>
          {conflict
            ? "This request conflicts with the current state"
            : "Action could not be completed"}
        </strong>
        <p>{error instanceof Error ? error.message : String(error)}</p>
        {conflict &&
          error instanceof Error &&
          /proposal|recommendation|stale/i.test(error.message) && (
            <p>
              Refresh the snapshot and recompute the recommendation before
              continuing.
            </p>
          )}
      </div>
      {retry && (
        <button className="button small" onClick={retry}>
          Refresh
        </button>
      )}
    </div>
  );
}
export function Loading({
  label = "Loading operational snapshot…",
}: {
  label?: string;
}) {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      {label}
    </div>
  );
}
export function Stat({
  label,
  value,
  detail,
  icon,
  alert = false,
}: {
  label: string;
  value: number | string;
  detail: string;
  icon: string;
  alert?: boolean;
}) {
  return (
    <div className={`stat ${alert ? "stat-alert" : ""}`}>
      <div className="stat-top">
        <span>{label}</span>
        <Icon name={icon} />
      </div>
      <div className="stat-value">{value}</div>
      <p>{detail}</p>
    </div>
  );
}
export function JsonDetails({
  title,
  value,
}: {
  title: string;
  value: unknown;
}) {
  return (
    <details className="json-details">
      <summary>{title}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
export function Pagination({
  offset,
  total,
  onChange,
}: {
  offset: number;
  total: number;
  onChange: (offset: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        {total === 0
          ? "0 records"
          : `${offset + 1}–${Math.min(offset + 15, total)} of ${total}`}
      </span>
      <div>
        <button
          className="button small"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - 15))}
        >
          Previous
        </button>
        <button
          className="button small"
          disabled={offset + 15 >= total}
          onClick={() => onChange(offset + 15)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
