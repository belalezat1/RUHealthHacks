import type { Consultation, Hospital } from "../api/types";
import {
  consultPriority,
  hospitalName,
  minutesSince,
} from "../lib/format";
import { IconClock, IconLink } from "./Icons";

function sessionLabel(status: string): { label: string; ok: boolean } {
  if (status === "in_progress") return { label: "Synapse active", ok: true };
  if (status === "waiting") return { label: "Synapse ready", ok: true };
  return { label: "No session", ok: false };
}

type Props = {
  consultations: Consultation[];
  hospitals: Hospital[];
  asOf: string;
};

export function ConsultBoard({ consultations, hospitals, asOf }: Props) {
  const rows = [...consultations].sort((a, b) => {
    const pa = a.priority === "urgent" ? 0 : 1;
    const pb = b.priority === "urgent" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return (
      new Date(a.requested_at).getTime() - new Date(b.requested_at).getTime()
    );
  });

  return (
    <div className="consult-board">
      {rows.map((c) => {
        const pri = consultPriority(c.priority);
        const wait = minutesSince(c.requested_at, asOf);
        const session = sessionLabel(c.status);
        return (
          <div className="consult-row" key={c.id}>
            <div className="consult-main">
              <div className="consult-top">
                <strong>{hospitalName(c.hospital_id, hospitals)}</strong>
                <span className={`pill pill-${pri.tone}`}>{pri.label}</span>
              </div>
              <div className="consult-meta">
                <span className="pill pill-muted">{c.specialty}</span>
                <span>
                  <IconClock size={13} /> {wait} min waiting
                </span>
                <span className={session.ok ? "session-ok" : "session-off"}>
                  <IconLink size={13} /> {session.label}
                </span>
                <span className="pill pill-muted">{c.status.replace("_", " ")}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}