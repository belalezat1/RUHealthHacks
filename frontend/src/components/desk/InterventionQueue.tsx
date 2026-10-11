import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useDemo, type QueueItem } from "../../demo/store";
import { eligibleOf } from "../../demo/interventions";
import { clock, hospitalName } from "../../lib/format";
import { IconRoute } from "../Icons";
import { Card, EASE, Pill, sentence, type Tone } from "../ui";

const TONE: Record<string, Tone> = { critical: "critical", high: "critical", medium: "caution", low: "muted" };

function statusLabel(item: QueueItem) {
  if (item.status === "partial") return "Partly covered";
  if (item.status === "in_progress") {
    const step = item.intervention?.offerStep;
    return step === "sent" ? "Offer sent" : step === "approved" ? "Approved" : step === "declined" ? "Declined, pick next" : "In review";
  }
  return "Needs backup";
}

/**
 * Every open coverage risk in priority order. Each row opens its own
 * intervention, so backup can be found for any of them, not just the top one.
 */
export function InterventionQueue({ goToDesk = false, index }: { goToDesk?: boolean; index?: number }) {
  const { queue, activeRiskId, openIntervention, dashboard } = useDemo();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const open = (id: string) => {
    openIntervention(id);
    if (goToDesk) navigate("/app");
  };

  return (
    <Card
      id={goToDesk ? undefined : "queue"}
      title="Intervention queue"
      count={queue.length ? `×${queue.length}` : undefined}
      icon={<IconRoute size={18} />}
      index={index}
    >
      {queue.length ? (
        <ol className="rx-queue">
          <AnimatePresence initial={false}>
            {queue.map((item, i) => {
              const id = String(item.risk.id);
              const backups = item.intervention ? eligibleOf(item.intervention.recommendation).length : null;
              const isActive = id === activeRiskId && item.status !== "needs_backup";
              return (
                <motion.li
                  key={id}
                  layout={!reduce}
                  initial={reduce ? false : { opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className={`rx-queue-item${isActive ? " is-active" : ""}`}
                >
                  <span className="rx-queue-rank num">{i + 1}</span>
                  <div className="rx-queue-main">
                    <div className="rx-queue-head">
                      <strong>{hospitalName(item.risk.hospital_id, dashboard.hospitals)}</strong>
                      <Pill tone={TONE[String(item.risk.severity).toLowerCase()] ?? "muted"} dot>
                        {sentence(String(item.risk.severity))}
                      </Pill>
                    </div>
                    <p>{item.risk.reason}</p>
                    <span className="rx-queue-meta num">
                      {Number(item.risk.unmet_minutes ?? 0)} min uncovered · starts {clock(String(item.risk.start_at))} ET
                      {backups != null ? ` · ${backups} eligible backup${backups === 1 ? "" : "s"}` : ""}
                    </span>
                  </div>
                  <div className="rx-queue-side">
                    <span className={`rx-queue-status is-${item.status}`}>{statusLabel(item)}</span>
                    <button type="button" className="rx-btn rx-btn-primary rx-btn-sm" onClick={() => open(id)}>
                      {item.status === "needs_backup"
                        ? "Find backup"
                        : item.status === "partial"
                          ? "Find more backup"
                          : "Continue"}
                      <span className="rx-btn-arrow" aria-hidden>
                        →
                      </span>
                    </button>
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      ) : (
        <div className="rx-empty">
          <strong>No open coverage risks</strong>
          Inject an event in the scenario lab to raise one.
        </div>
      )}
    </Card>
  );
}
