import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useDemo } from "../../demo/store";
import { IconX } from "../Icons";
import { EASE } from "../ui";

const DURATION = 5200;

/**
 * Celebrates each human "yes" in the offer loop: the clinical lead's approval
 * and the physician's acceptance. Auto-dismisses; hover or focus pauses it.
 */
export function ConfirmationToast() {
  const { confirmation, dismissConfirmation } = useDemo();
  const reduce = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const remaining = useRef(DURATION);
  const startedAt = useRef(0);

  useEffect(() => {
    remaining.current = DURATION;
    setPaused(false);
  }, [confirmation?.id]);

  useEffect(() => {
    if (!confirmation || paused) return;
    startedAt.current = performance.now();
    const t = window.setTimeout(dismissConfirmation, remaining.current);
    return () => {
      window.clearTimeout(t);
      remaining.current -= performance.now() - startedAt.current;
    };
  }, [confirmation, paused, dismissConfirmation]);

  useEffect(() => {
    if (!confirmation) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismissConfirmation();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmation, dismissConfirmation]);

  return (
    <div className="rx-confirm-layer" aria-live="polite">
      <AnimatePresence>
        {confirmation ? (
          <motion.div
            key={confirmation.id}
            className={`rx-confirm is-${confirmation.kind}${paused ? " is-paused" : ""}`}
            role="status"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -24, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -12, scale: 0.97 }}
            transition={{ duration: 0.42, ease: EASE }}
          >
            <div className="rx-confirm-badge" aria-hidden>
              {!reduce ? (
                <motion.span
                  className="rx-confirm-ring"
                  initial={{ scale: 0.6, opacity: 0.55 }}
                  animate={{ scale: 1.9, opacity: 0 }}
                  transition={{ duration: 0.9, delay: 0.35, ease: "easeOut" }}
                />
              ) : null}
              <motion.span
                className="rx-confirm-disc"
                initial={reduce ? false : { scale: 0.4 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.45, delay: 0.08, ease: [0.34, 1.4, 0.64, 1] }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                  <motion.path
                    d="M5 12.5l4.2 4.2L19 7"
                    stroke="currentColor"
                    strokeWidth={2.6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={reduce ? false : { pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.4, delay: 0.32, ease: EASE }}
                  />
                </svg>
              </motion.span>
            </div>

            <div className="rx-confirm-body">
              <span className="rx-confirm-party">
                {confirmation.party} · {confirmation.kind === "approved" ? "approved" : "accepted"}
              </span>
              <strong className="rx-confirm-title">{confirmation.title}</strong>
              <p className="rx-confirm-detail">{confirmation.detail}</p>
              <ul className="rx-confirm-facts">
                {confirmation.facts.map((f, i) => (
                  <motion.li
                    key={f}
                    className="num"
                    initial={reduce ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.45 + i * 0.08, ease: EASE }}
                  >
                    {f}
                  </motion.li>
                ))}
              </ul>
            </div>

            <button
              type="button"
              className="rx-icon-btn rx-icon-btn-sm rx-confirm-close"
              aria-label="Dismiss confirmation"
              onClick={dismissConfirmation}
            >
              <IconX size={15} />
            </button>

            <span className="rx-confirm-timer" aria-hidden>
              <i style={{ animationDuration: `${DURATION}ms` }} />
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
