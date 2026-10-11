import { useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { Physician } from "../../api/types";
import { useDemo } from "../../demo/store";
import { experienceOf, seniority, usd } from "../../demo/economics";
import { consultPriority, hospitalName, minutesSince, minutesUntil, physicianName } from "../../lib/format";
import { IconChevron, IconLink, IconQueue, IconUsers } from "../Icons";
import { Avatar, Card, EASE, Pill, sentence, type Tone } from "../ui";
import { Reveal } from "../Reveal";
import { eligibleOf } from "../../demo/interventions";

function useQuery() {
  const [params] = useSearchParams();
  return (params.get("q") ?? "").trim().toLowerCase();
}

function Empty({ q, what }: { q: string; what: string }) {
  return (
    <div className="rx-empty">
      <strong>No {what} match “{q}”</strong>
      Try a physician surname, hospital, or status.
    </div>
  );
}

/* Physicians -------------------------------------------------------------- */

const STATUS_TONE: Record<string, Tone> = {
  available: "ok",
  busy: "caution",
  in_meeting: "muted",
};

function signal(p: Physician): { label: string; tone: Tone } {
  if (!p.availability.connected) return { label: "Offline", tone: "critical" };
  if (p.availability.stale) return { label: "Unverified", tone: "caution" };
  if (p.availability.conflicts?.length) return { label: "Conflict", tone: "caution" };
  return { label: "Verified", tone: "ok" };
}

export function PhysicianTable() {
  const { dashboard, recommendation, activeHospitalId } = useDemo();
  const gapHospital = activeHospitalId ? hospitalName(activeHospitalId, dashboard.hospitals) : "this gap";
  const q = useQuery();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState<string | null>(null);

  const eligibleIds = new Set(eligibleOf(recommendation).map((c) => c.physician_id));
  const rejected = new Map(recommendation.rejected.map((r) => [String(r.physician_id), r.reason]));

  const rows = dashboard.physicians.filter((p) => {
    if (!q) return true;
    const econ = experienceOf(p.id);
    return [p.name, p.availability.status, econ ? seniority(econ.years) : ""].join(" ").toLowerCase().includes(q);
  });
  const cols = { "--cols": "minmax(0, 2.2fr) minmax(0, 1fr) minmax(0, 0.9fr) minmax(0, 0.9fr) 30px" } as CSSProperties;

  return (
    <Card
      id="physicians"
      title="Physicians"
      count={`×${dashboard.physicians.length}`}
      icon={<IconUsers size={18} />}
      bodyClassName=""
      index={4}
    >
      <div className="rx-table" style={cols}>
        <div className="rx-table-head" aria-hidden>
          <span>Physician</span>
          <span>Status</span>
          <span className="hide-sm">Shift</span>
          <span className="hide-sm">Signal</span>
          <span />
        </div>
        {rows.length ? (
          <ul className="rx-table-body">
            {rows.map((p, rowIndex) => {
              const econ = experienceOf(p.id);
              const isOpen = open === p.id;
              const sig = signal(p);
              const elig = eligibleIds.has(p.id)
                ? `Eligible for the ${gapHospital} split shift`
                : rejected.has(p.id)
                  ? `Excluded: ${rejected.get(p.id)}`
                  : p.availability.on_shift
                    ? "On shift, not part of this offer"
                    : "Not evaluated for this gap";
              return (
                <Reveal
                  as="li"
                  key={p.id}
                  className={`rx-table-item${isOpen ? " is-open" : ""}`}
                  delay={Math.min(rowIndex, 8) * 0.04}
                >
                  <button
                    type="button"
                    className="rx-table-row"
                    aria-expanded={isOpen}
                    aria-controls={`phy-${p.id}`}
                    onClick={() => setOpen(isOpen ? null : p.id)}
                  >
                    <span className="rx-cell-main">
                      <Avatar name={p.name} seed={p.id} />
                      <span style={{ minWidth: 0 }}>
                        <strong>{p.name}</strong>
                        <span className="num">
                          {econ ? `${econ.years} yrs · ${seniority(econ.years)}` : "Neurology"}
                        </span>
                      </span>
                    </span>
                    <span>
                      <Pill tone={STATUS_TONE[p.availability.status] ?? "muted"} dot>
                        {sentence(p.availability.status)}
                      </Pill>
                    </span>
                    <span className="rx-cell-muted hide-sm">{p.availability.on_shift ? "On shift" : "Off shift"}</span>
                    <span className="hide-sm">
                      <Pill tone={sig.tone}>{sig.label}</Pill>
                    </span>
                    <span className="rx-chev" aria-hidden>
                      <IconChevron size={16} />
                    </span>
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen ? (
                      <motion.div
                        id={`phy-${p.id}`}
                        className="rx-detail"
                        initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                        animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
                        exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: EASE }}
                      >
                        <div className="rx-detail-inner">
                          <dl>
                            <dt>Rate</dt>
                            <dd className="num">{econ ? `${usd(econ.rate)}/h` : "—"}</dd>
                          </dl>
                          <dl>
                            <dt>Workload</dt>
                            <dd className="num">
                              {p.availability.workload ?? 0} of {p.max_concurrent} consults
                            </dd>
                          </dl>
                          <dl>
                            <dt>Connection</dt>
                            <dd>{p.availability.connected ? "Connected" : "Disconnected"}</dd>
                          </dl>
                          <dl>
                            <dt>Signal</dt>
                            <dd>
                              {p.availability.conflicts?.length
                                ? "Camera active without Synapse"
                                : p.availability.stale
                                  ? "Stale, needs confirmation"
                                  : "Consistent"}
                            </dd>
                          </dl>
                          <p className="rx-detail-note">{elig}</p>
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </Reveal>
              );
            })}
          </ul>
        ) : (
          <Empty q={q} what="physicians" />
        )}
      </div>
    </Card>
  );
}

/* Consult queue ----------------------------------------------------------- */

export function ConsultQueue() {
  const { dashboard } = useDemo();
  const q = useQuery();
  const asOf = dashboard.as_of;

  const rows = [...dashboard.consultations]
    .sort((a, b) => {
      const pa = consultPriority(a.priority).tone === "critical" ? 0 : 1;
      const pb = consultPriority(b.priority).tone === "critical" ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return new Date(a.deadline_at).getTime() - new Date(b.deadline_at).getTime();
    })
    .filter((c) => {
      if (!q) return true;
      const assigned = c.physician_id ? physicianName(String(c.physician_id), dashboard.physicians) : "";
      return [hospitalName(c.hospital_id, dashboard.hospitals), c.priority, c.status, assigned]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });

  const cols = { "--cols": "minmax(0, 2.4fr) minmax(0, 0.9fr) minmax(0, 1.15fr) minmax(0, 0.8fr)" } as CSSProperties;

  return (
    <Card
      id="consults"
      title="Consult queue"
      count={`×${dashboard.consultations.length}`}
      icon={<IconQueue size={18} />}
      bodyClassName=""
      index={5}
    >
      <div className="rx-table" style={cols}>
        <div className="rx-table-head" aria-hidden>
          <span>Hospital</span>
          <span>Priority</span>
          <span>Deadline</span>
          <span className="hide-sm">Synapse</span>
        </div>
        {rows.length ? (
          <ul className="rx-table-body">
            {rows.map((c, rowIndex) => {
              const pri = consultPriority(c.priority);
              const wait = minutesSince(c.requested_at, asOf);
              const due = minutesUntil(c.deadline_at, asOf);
              const dueTone = c.status !== "waiting" ? "" : due <= 0 ? "critical" : due <= 15 ? "caution" : "";
              const assigned = c.physician_id ? physicianName(String(c.physician_id), dashboard.physicians) : null;
              return (
                <Reveal as="li" key={c.id} className="rx-table-item" delay={Math.min(rowIndex, 8) * 0.05}>
                  <div className="rx-table-row">
                    <span className="rx-cell-main">
                      <Avatar name={hospitalName(c.hospital_id, dashboard.hospitals)} seed={c.hospital_id} />
                      <span style={{ minWidth: 0 }}>
                        <strong>{hospitalName(c.hospital_id, dashboard.hospitals)}</strong>
                        <span className="num">
                          {assigned ?? "Unassigned"} · waiting {wait} min
                        </span>
                      </span>
                    </span>
                    <span>
                      <Pill tone={pri.tone === "critical" ? "critical" : pri.tone === "caution" ? "caution" : "muted"}>
                        {sentence(pri.label)}
                      </Pill>
                    </span>
                    <span className={`rx-wait num ${dueTone}`}>
                      {c.status !== "waiting"
                        ? sentence(c.status)
                        : due <= 0
                          ? `Overdue ${-due} min`
                          : `Due in ${due} min`}
                    </span>
                    <span className="rx-session hide-sm">
                      <IconLink size={14} />
                      {c.status === "in_progress" ? "Active" : c.status === "waiting" ? "Ready" : "No session"}
                    </span>
                  </div>
                </Reveal>
              );
            })}
          </ul>
        ) : (
          <Empty q={q} what="consults" />
        )}
      </div>
    </Card>
  );
}
