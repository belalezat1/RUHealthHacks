import { useDemo } from "../../demo/store";
import { clock, hospitalName, minutesUntil, physicianName } from "../../lib/format";
import { flowStage } from "../../lib/workflow";
import { IconClock } from "../Icons";
import { Pill, sentence, WorkflowSteps } from "../ui";

/**
 * The single most important thing on the desk. Deliberately static: a critical
 * alert should read instantly, not pulse for attention.
 */
export function PriorityAlert() {
  const { dashboard, offerStep, lastFill, openDecide } = useDemo();
  const risk = dashboard.forecast.risks[0];
  const stage = flowStage(offerStep, Boolean(risk));

  if (offerStep === "filled" && lastFill) {
    const left = lastFill.gapMinutes - lastFill.minutesClosed;
    const partial = left > 0;
    const name = physicianName(lastFill.physicianId, dashboard.physicians);
    return (
      <section
        className={`rx-alert rx-enter ${partial ? "is-partial" : "is-resolved"}`}
        style={{ ["--i" as string]: 0 }}
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
            Riverfront Medical Center
          </div>
          <h2>{partial ? `${left} minutes still need cover at Riverfront` : "Coverage restored at Riverfront"}</h2>
          <p>
            {name} accepted and closes {lastFill.minutesClosed} of {lastFill.gapMinutes} uncovered minutes.{" "}
            {partial
              ? "Review the remaining risk before offering more cover."
              : "Offers stopped. Projected capacity meets the minimum for the next 90 minutes."}
          </p>
        </div>
        <div className="rx-alert-side">
          <WorkflowSteps stage={stage} />
        </div>
      </section>
    );
  }

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
  const inFlight = stage === 2;

  return (
    <section className="rx-alert rx-enter" style={{ ["--i" as string]: 0 }} aria-labelledby="rx-alert-title">
      {mins != null ? (
        <div className="rx-alert-clock" aria-hidden>
          <strong className="num">{mins}</strong>
          <span>min to gap</span>
        </div>
      ) : null}
      <div className="rx-alert-copy">
        <div className="rx-alert-meta">
          <Pill tone="critical" dot>
            {sentence(String(risk.severity))} risk
          </Pill>
          <IconClock size={13} />
          <span className="num">Starts {clock(String(risk.start_at))} ET</span>
        </div>
        <h2 id="rx-alert-title">
          {mins != null ? `Coverage gap in ${mins} min at ${hospital}` : `Coverage risk at ${hospital}`}
        </h2>
        <p>{risk.reason ?? risk.explanation}</p>
      </div>
      <div className="rx-alert-side">
        <WorkflowSteps stage={stage} />
        <button type="button" className="rx-btn rx-btn-primary rx-btn-lg" onClick={openDecide}>
          {inFlight
            ? "Continue intervention"
            : "Review intervention"}
          <span className="rx-btn-arrow" aria-hidden>
            →
          </span>
        </button>
      </div>
    </section>
  );
}
