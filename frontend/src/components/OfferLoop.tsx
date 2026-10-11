import { AnimatePresence, motion } from "framer-motion";
import { useDemo, type OfferStep } from "../demo/store";
import { usd } from "../demo/economics";
import { physicianName } from "../lib/format";

const STEPS: { key: OfferStep; label: string }[] = [
  { key: "ready", label: "Propose" },
  { key: "approved", label: "Approve" },
  { key: "sent", label: "Send" },
  { key: "accepted", label: "Respond" },
];

function stepIndex(step: OfferStep) {
  if (step === "filled" || step === "accepted") return 4;
  if (step === "declined") return 3;
  if (step === "sent") return 2;
  if (step === "approved") return 1;
  if (step === "ready" || step === "checking") return 0;
  return -1;
}

export function OfferLoop() {
  const demo = useDemo();
  const idx = stepIndex(demo.offerStep);
  const busy = demo.offerStep === "checking";
  const primaryName = demo.primary
    ? physicianName(demo.primary.candidate.physician_id, demo.dashboard.physicians)
    : "";
  const fillName = demo.lastFill
    ? physicianName(demo.lastFill.physicianId, demo.dashboard.physicians)
    : "";
  const gapLeft = demo.lastFill ? demo.lastFill.gapMinutes - demo.lastFill.minutesClosed : 0;
  const fullFill = gapLeft <= 0;

  return (
    <div>
      <div className="stepper" aria-label="Offer loop progress">
        {STEPS.map((s, i) => {
          const state = i === idx ? "on" : i < idx ? "done" : "";
          return (
            <motion.span
              key={s.key}
              className={`step ${state}`}
              layout
              animate={
                state === "on"
                  ? { scale: [1, 1.06, 1], boxShadow: ["0 0 0 rgba(18,163,122,0)", "0 0 18px rgba(18,163,122,0.45)", "0 0 10px rgba(18,163,122,0.25)"] }
                  : { scale: 1 }
              }
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            >
              {i + 1}. {s.label}
            </motion.span>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {busy ? (
          <motion.div
            key="labor"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            style={{ marginBottom: 16 }}
          >
            <div className="skeleton" style={{ height: 14, width: "70%", marginBottom: 8 }} />
            <p style={{ color: "var(--text-soft)", margin: 0 }}>
              {demo.laborSteps[Math.max(0, demo.laborIndex)] ?? "Validating…"}
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        <motion.div
          key={demo.offerStep}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        >
          {demo.offerStep === "filled" ? (
            fullFill ? (
              <div className="success-banner" role="status">
                <strong>Gap filled. Offers stopped.</strong>
                <p style={{ margin: "8px 0 0", color: "var(--text-soft)" }}>
                  {fillName} closes all {demo.lastFill?.gapMinutes} uncovered minutes. Audit
                  trail recorded. No further offers will be sent for this gap.
                </p>
              </div>
            ) : (
              <div className="partial-banner" role="status">
                <strong>
                  Gap reduced, not closed: {gapLeft} min still uncovered
                </strong>
                <p style={{ margin: "8px 0 0", color: "var(--text-soft)" }}>
                  {fillName} closes {demo.lastFill?.minutesClosed} of{" "}
                  {demo.lastFill?.gapMinutes} minutes. Review the remaining risk before
                  offering more cover.
                </p>
              </div>
            )
          ) : (
            <div className="offer-actions">
              {demo.primary && (demo.offerStep === "idle" || demo.offerStep === "ready") ? (
                <p className="offer-target">
                  Offer goes to <strong>{primaryName}</strong> ·{" "}
                  <span className="tabular">{usd(demo.primary.cost)}</span> est.
                </p>
              ) : null}
              {(demo.offerStep === "idle" || demo.offerStep === "ready") && (
                <>
                  <button className="btn btn-ghost" type="button" onClick={() => demo.runLaborCheck()}>
                    Re-check eligibility
                  </button>
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={!demo.primary}
                    onClick={() => demo.approve()}
                  >
                    Approve offer
                    <span className="btn-arrow" aria-hidden>→</span>
                  </button>
                </>
              )}
              {demo.offerStep === "approved" && (
                <button className="btn btn-primary" type="button" onClick={() => demo.sendOffer()}>
                  Send offer to {primaryName}
                  <span className="btn-arrow" aria-hidden>→</span>
                </button>
              )}
              {demo.offerStep === "sent" && (
                <>
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => demo.physicianRespond(true)}
                  >
                    Physician accepts
                  </button>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => demo.physicianRespond(false)}
                  >
                    Physician declines
                  </button>
                </>
              )}
              {demo.offerStep === "declined" &&
                (demo.primary ? (
                  <button className="btn btn-primary" type="button" onClick={() => demo.proposeNext()}>
                    Propose next: {primaryName}
                    <span className="btn-arrow" aria-hidden>→</span>
                  </button>
                ) : (
                  <button className="btn btn-ghost" type="button" onClick={() => demo.resetFlow()}>
                    No eligible candidates left · reset demo
                  </button>
                ))}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
      <p style={{ marginTop: 14, fontSize: 14, color: "var(--text-soft)" }}>
        Human approval before every offer. No patient information in notifications.
        One open offer per physician · max 3/week · 10-minute expiry.
      </p>
    </div>
  );
}