// Preserve source rows exactly, including quoted commas/newlines and escaped quotes.
// Presets select existing records; they never invent IDs, times, or clinical events.
export type EventPreset = "all" | "outage" | "arrivals" | "late";

function records(text: string): string[] {
  const result: string[] = [];
  let quoted = false, start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (text[i] === "\n" && !quoted) {
      const row = text.slice(start, i).replace(/\r$/, "");
      if (row.trim()) result.push(row);
      start = i + 1;
    }
  }
  const last = text.slice(start).replace(/\r$/, "");
  if (last.trim()) result.push(last);
  return result;
}

function cells(row: string): string[] {
  const result: string[] = [];
  let quoted = false, field = "";
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '"') {
      if (quoted && row[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (row[i] === "," && !quoted) { result.push(field); field = ""; }
    else field += row[i];
  }
  result.push(field);
  return result;
}

export function suppliedRowCount(text: string): number { return Math.max(0, records(text).length - 1); }

export function selectSuppliedEvents(text: string, preset: EventPreset, hospital = ""): string {
  const [header, ...rows] = records(text);
  if (!header) return "";
  const columns = cells(header.replace(/^\uFEFF/, ""));
  const selected = rows.filter(row => {
    const values = cells(row);
    const value = (column: string) => values[columns.indexOf(column)] ?? "";
    if (hospital && value("hospital_id") !== hospital) return false;
    const type = value("event_type");
    if (preset === "outage") return type === "agent_heartbeat_lost" || (type === "physician_status_changed" && value("description").includes("Temporarily Unavailable"));
    if (preset === "arrivals") return type === "consult_received";
    if (preset === "late") return ["camera_active", "camera_inactive", "agent_heartbeat_lost", "physician_status_changed"].includes(type) && Date.parse(value("ingested_at")) > Date.parse(value("event_time"));
    return true;
  });
  return selected.length ? [header, ...selected].join("\n") + "\n" : "";
}
