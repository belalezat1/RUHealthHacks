export function hospitalName(
  id: string,
  hospitals: { id: string; name: string }[],
): string {
  return hospitals.find((h) => h.id === id)?.name ?? id;
}

export function physicianName(
  id: string,
  physicians: { id: string; name: string }[],
): string {
  return physicians.find((p) => p.id === id)?.name ?? id;
}

export function clock(iso?: string | null): string {
  if (!iso) return "-";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function clockDate(iso?: string | null): string {
  if (!iso) return "-";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function minutesUntil(iso: string, nowIso: string): number {
  return Math.round(
    (new Date(iso).getTime() - new Date(nowIso).getTime()) / 60000,
  );
}

export function minutesSince(iso: string, nowIso: string): number {
  return Math.max(
    0,
    Math.round(
      (new Date(nowIso).getTime() - new Date(iso).getTime()) / 60000,
    ),
  );
}

export function severityTone(
  severity: string,
): "critical" | "caution" | "signal" | "muted" {
  const s = severity.toLowerCase();
  if (s.includes("critical") || s.includes("high") || s === "red")
    return "critical";
  if (s.includes("medium") || s.includes("warn") || s.includes("amber"))
    return "caution";
  if (s.includes("low") || s.includes("ok") || s.includes("green"))
    return "signal";
  return "muted";
}

export function consultPriority(priority: string): {
  label: string;
  tone: "critical" | "caution" | "muted";
} {
  const p = priority.toLowerCase();
  if (p.includes("urgent") || p.includes("stroke"))
    return { label: "stroke", tone: "critical" };
  if (p.includes("high")) return { label: "urgent", tone: "caution" };
  return { label: "routine", tone: "muted" };
}