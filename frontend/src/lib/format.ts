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
  if (!iso) return "—";
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

export function minutesUntil(iso: string, nowIso: string): number {
  return Math.round(
    (new Date(iso).getTime() - new Date(nowIso).getTime()) / 60000,
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