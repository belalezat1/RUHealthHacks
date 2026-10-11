import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useDemo, type OfferStep } from "../demo/store";
import { usd } from "../demo/economics";
import { physicianName } from "../lib/format";
import { IconCheck } from "./Icons";
import { EASE } from "./ui";

const STEPS = ["Propose", "Approve", "Send", "Respond"];

/** Index of the step in progress (4 = loop complete). */
function stepIndex(step: OfferStep) {
  if (step === "filled" || step === "accepted") return 4;
  if (step === "declined") return 3;
  if (step === "sent") return 3;
  if (step === "approved") return 2;
  if (step === "ready" || step === "checking") return 1;
  return 0;
}

function Arrow() {
  return (
    <span className="rx-btn-arrow" aria-hidden>
      →
    </span>
  );
}

export function OfferLoop() {
  const demo = useDemo();
  const reduce = useReducedMotion();
  const idx = stepIndex(demo.offerStep);
  const busy = demo.offerStep === "checking";
  const primaryName = demo.primary
    ? physicianName(demo.primary.candidate.physician_id, demo.dashboard.physicians)
    : "";
  const fillName = demo.lastFill ? physicianName(demo.lastFill.physicianId, demo.dashboard.physicians) : "";
  const gapLeft = demo.lastFill ? demo.lastFill.gapMinutes - demo.lastFill.minutesClosed : 0;
  const deciding = demo.offerStep === "idle" || demo.offerStep === "ready" || busy;

  return (
    <div>
      <ol className="rx-steps" aria-label="Offer progress">
        {STEPS.map((s, i) => {
          const state = i < idx ? "is-done" : i === idx ? "is-current" : "";
          return (
            <li key={s} className={state} aria-current={i === idx ? "step" : undefined}>
              <i aria-hidden>
                <motion.b
                  initial={false}
                  animate={{ scaleX: i < idx ? 1 : i === idx ? 0.35 : 0 }}
                  transition={{ duration: reduce ? 0 : 0.4, ease: EASE }}
                />
              </i>
              {s}
            </li>
          );
        })}
      </ol>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={demo.offerStep === "checking" ? "ready" : demo.offerStep}
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, y: -4 }}
          transition={{ duration: 0.22, ease: EASE }}
        >
          {demo.offerStep === "filled" ? (
            gapLeft <= 0 ? (
              <div className="rx-callout ok" role="status">
                <strong>Gap filled. Offers stopped.</strong>
                <p>
                  {fillName} closes all {demo.lastFill?.gapMinutes} uncovered minutes. Audit trail recorded. No
                  further offers will be sent for this gap.
                </p>
              </div>
            ) : (
              <div className="rx-callout warn" role="status">
                <strong>Gap reduced, not closed: {gapLeft} min still uncovered</strong>
                <p>
                  {fillName} closes {demo.lastFill?.minutesClosed} of {demo.lastFill?.gapMinutes} minutes. Review
                  the remaining risk before offering more cover.
                </p>
              </div>
            )
          ) : (
            <>
              {demo.primary && deciding ? (
                <p className="rx-offer-target">
                  Offer goes to <strong>{primaryName}</strong> ·{" "}
                  <span className="num">{usd(demo.primary.cost)}</span> estimated
                </p>
              ) : null}

              {busy ? (
                <ul className="rx-checks" aria-live="polite">
                  {demo.laborSteps.map((label, i) => {
                    const state = i < demo.laborIndex ? "is-done" : i === demo.laborIndex ? "is-current" : "";
                    return (
                      <li key={label} className={state}>
                        <span className="rx-checks-mark" aria-hidden>
                          {i < demo.laborIndex ? <IconCheck size={12} strokeWidth={2.4} /> : i === demo.laborIndex ? <span className="rx-spinner" /> : null}
                        </span>
                        {label}
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              <div className="rx-actions">
                {deciding ? (
                  <>
                    <button
                      className="rx-btn rx-btn-secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => demo.runLaborCheck()}
                    >
                      {busy ? <span className="rx-spinner" aria-hidden /> : null}
                      {busy ? "Checking eligibility…" : "Re-check eligibility"}
                    </button>
                    <button
                      className="rx-btn rx-btn-primary"
                      type="button"
                      disabled={!demo.primary || busy}
                      onClick={() => demo.approve()}
                    >
                      Approve offer
                      <Arrow />
                    </button>
                  </>
                ) : null}
                {demo.offerStep === "approved" ? (
                  <button className="rx-btn rx-btn-primary" type="button" onClick={() => demo.sendOffer()}>
                    Send offer to {primaryName}
                    <Arrow />
                  </button>
                ) : null}
                {demo.offerStep === "sent" ? (
                  <>
                    <button className="rx-btn rx-btn-primary" type="button" onClick={() => demo.physicianRespond(true)}>
                      <IconCheck size={16} strokeWidth={2.2} />
                      Physician accepts
                    </button>
                    <button className="rx-btn rx-btn-danger" type="button" onClick={() => demo.physicianRespond(false)}>
                      Physician declines
                    </button>
                  </>
                ) : null}
                {demo.offerStep === "accepted" ? (
                  <button className="rx-btn rx-btn-primary is-success" type="button" disabled>
                    <IconCheck size={16} strokeWidth={2.2} />
                    Accepted · updating coverage
                  </button>
                ) : null}
                {demo.offerStep === "declined" ? (
                  demo.primary ? (
                    <button className="rx-btn rx-btn-primary" type="button" onClick={() => demo.proposeNext()}>
                      Propose next: {primaryName}
                      <Arrow />
                    </button>
                  ) : (
                    <button className="rx-btn rx-btn-secondary" type="button" onClick={() => demo.resetFlow()}>
                      No eligible candidates left · reset demo
                    </button>
                  )
                ) : null}
              </div>
            </>
          )}
        </motion.div>
      </AnimatePresence>

      <p className="rx-policy">
        Human approval before every offer. No patient information in notifications. One open offer per physician ·
        max 3 per week · 10-minute expiry.
      </p>
    </div>
  );
}
