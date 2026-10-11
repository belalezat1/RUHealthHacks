import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useDemo } from "../../demo/store";
import { flowStage } from "../../lib/workflow";
import { EligibilityMatrix } from "../EligibilityMatrix";
import { IconX } from "../Icons";
import { OfferEconomics } from "../OfferEconomics";
import { OfferLoop } from "../OfferLoop";
import { EASE, Scrim, useExitSafe, WorkflowSteps } from "../ui";

function DrawerSurface({
  surfaceRef,
  reduce,
  children,
}: {
  surfaceRef: RefObject<HTMLElement | null>;
  reduce: boolean;
  children: ReactNode;
}) {
  const safe = useExitSafe();
  return (
    <motion.aside
      ref={surfaceRef}
      tabIndex={-1}
      className="rx-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rx-drawer-title"
      style={safe}
      initial={reduce ? { opacity: 0 } : { x: "100%" }}
      animate={reduce ? { opacity: 1 } : { x: 0 }}
      exit={reduce ? { opacity: 0 } : { x: "100%" }}
      transition={{ duration: 0.34, ease: EASE }}
    >
      {children}
    </motion.aside>
  );
}

/** Decide → Act side panel. Traps the reader's attention, not their keyboard. */
export function OfferDrawer() {
  const demo = useDemo();
  const { panel, setPanel, recommendation, dashboard, offerStep, activeHospitalId } = demo;
  const where = activeHospitalId
    ? (dashboard.hospitals.find((h) => h.id === activeHospitalId)?.name.split(" ")[0] ?? "")
    : "";
  const reduce = useReducedMotion();
  const open = panel !== "none";
  const ref = useRef<HTMLElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => ref.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPanel("none");
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      returnTo.current?.focus?.();
    };
  }, [open, setPanel]);

  return (
    <AnimatePresence>
      {open ? (
        <>
          <Scrim key="scrim" label="Close panel" onClose={() => setPanel("none")} />
          <DrawerSurface key="drawer" surfaceRef={ref} reduce={Boolean(reduce)}>
            <header className="rx-drawer-head">
              <div className="rx-drawer-top">
                <div>
                  <h2 id="rx-drawer-title">
                    {panel === "act" ? "Act on the offer" : "Find backup"}
                    {where ? ` · ${where}` : ""}
                  </h2>
                </div>
                <button
                  type="button"
                  className="rx-icon-btn rx-icon-btn-sm"
                  aria-label="Close panel"
                  onClick={() => setPanel("none")}
                >
                  <IconX size={16} />
                </button>
              </div>
              <WorkflowSteps stage={flowStage(offerStep, dashboard.forecast.risks.length > 0)} />
            </header>
            <div className="rx-drawer-body">
              <section className="rx-drawer-section">
                <OfferLoop />
              </section>
              <section className="rx-drawer-section">
                <h3>Offer order</h3>
                <OfferEconomics compact />
              </section>
              <section className="rx-drawer-section">
                <h3>Off-shift eligibility</h3>
                <EligibilityMatrix
                  recommendation={recommendation}
                  physicians={dashboard.physicians}
                  order={demo.ranked.map((c) => c.candidate.physician_id)}
                />
              </section>
            </div>
          </DrawerSurface>
        </>
      ) : null}
    </AnimatePresence>
  );
}
