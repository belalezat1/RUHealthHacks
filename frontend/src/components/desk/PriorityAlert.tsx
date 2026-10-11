import { useDemo } from "../../demo/store";
import { clock, hospitalName, minutesUntil, physicianName } from "../../lib/format";
import { flowStage } from "../../lib/workflow";
import { IconClock } from "../Icons";
import { Pill, sentence, WorkflowSteps } from "../ui";

/**
 * The single most important thing on the desk: the risk being worked, or the
 * highest-priority open one. Deliberately static: a critical alert should read
 * instantly, not pulse for attention.
 */
export function PriorityAlert() {
  const { dashboard, offerStep, lastFill, activeRisk, activeHospitalId, queue, openDecide, openIntervention } =
    useDemo();
  const next = queue.find((q) => q.risk.id !== activeRisk?.id);

  if (offerStep === "filled" && lastFill && activeHospitalId) {
    const left = lastFill.gapMinutes - lastFill.minutesClosed;
    const partial = left > 0;
    const name = physicianName(lastFill.physicianId, dashboard.physicians);
    const where = hospitalName(activeHospitalId, dashboard.hospitals);
    const short = where.split(" ")[0];
    return (
      <section
        className={`rx-alert rx-enter ${partial ? "is-partial" : "is-resolved"}`}
        role="status"
        aria-label="Coverage status"
      >
        <div className="rx-alert-clock">
          <strong className="num">{partial ? left : 0}</strong>
          <span>min uncovered</span>
        </div>
        <div className="rx-alert-copy">
          <div className="rx-alert-meta">
            <Pill tone={partial ? "caution" : "ok"} dot>
              {partial ? "Gap reduced" : "Resolved"}
            </Pill>
            {where}
          </div>
          <h2>{partial ? `${left} minutes still need cover at ${short}` : `Coverage restored at ${short}`}</h2>
          <p>
            {name} accepted and closes {lastFill.minutesClosed} of {lastFill.gapMinutes} uncovered minutes.{" "}
            {partial ? "Review the remaining risk before offering more cover." : "Offers stopped for this gap."}
          </p>
        </div>
        <div className="rx-alert-side">
          <WorkflowSteps stage={3} />
          {next ? (
            <button
              type="button"
              className="rx-btn rx-btn-primary"
              onClick={() => openIntervention(String(next.risk.id))}
            >
              Next: {hospitalName(next.risk.hospital_id, dashboard.hospitals).split(" ")[0]} ·{" "}
              {sentence(String(next.risk.severity))}
              <span className="rx-btn-arrow" aria-hidden>
                →
              </span>
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  const inFlight = activeRisk && offerStep !== "idle";
  const risk = inFlight ? activeRisk : queue[0]?.risk;

  if (!risk) {
    return (
      <section className="rx-alert is-resolved rx-enter" role="status" aria-label="Coverage status">
        <div className="rx-alert-clock">
          <strong className="num">0</strong>
          <span>open risks</span>
        </div>
        <div className="rx-alert-copy">
          <h2>Network stable for the next 90 minutes</h2>
          <p>No ranked coverage risks in the forecast horizon.</p>
        </div>
        <div className="rx-alert-side">
          <WorkflowSteps stage={0} />
        </div>
      </section>
    );
  }

  const mins = risk.start_at
    ? Math.max(1, Math.min(90, minutesUntil(String(risk.start_at), dashboard.as_of)))
    : null;
  const hospital = hospitalName(risk.hospital_id, dashboard.hospitals);
  const stage = inFlight ? flowStage(offerStep, true) : 1;
  const more = queue.length - 1;

  return (
    <section className="rx-alert rx-enter" aria-labelledby="rx-alert-title">
      {mins != null ? (
        <div className="rx-alert-clock" aria-hidden>
          <strong className="num">{mins}</strong>
          <span>min to gap</span>
        </div>
      ) : null}
      <div className="rx-alert-copy">
        <div className="rx-alert-meta">
          <Pill tone={String(risk.severity) === "medium" ? "caution" : "critical"} dot>
            {sentence(String(risk.severity))} risk
          </Pill>
          <IconClock size={13} />
          <span className="num">Starts {clock(String(risk.start_at))} ET</span>
          {more > 0 ? <span>· {more} more in the queue</span> : null}
        </div>
        <h2 id="rx-alert-title">
          {mins != null ? `Coverage gap in ${mins} min at ${hospital}` : `Coverage risk at ${hospital}`}
        </h2>
        <p>{risk.reason ?? risk.explanation}</p>
      </div>
      <div className="rx-alert-side">
        <WorkflowSteps stage={stage as 0 | 1 | 2 | 3} />
        <button
          type="button"
          className="rx-btn rx-btn-primary rx-btn-lg"
          onClick={() => (inFlight ? openDecide() : openIntervention(String(risk.id)))}
        >
          {inFlight ? "Continue intervention" : "Find backup"}
          <span className="rx-btn-arrow" aria-hidden>
            →
          </span>
        </button>
      </div>
    </section>
  );
}
