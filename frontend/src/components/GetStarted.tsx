import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { brand } from "../brand";
import { IconBolt, IconDesk } from "./Icons";

export function GetStarted() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Click to open, click outside or Escape to close. (Hover-to-open made the
  // first click close the menu it had just opened.)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="lp-menu-wrap" ref={ref}>
      <button
        type="button"
        className="rx-btn rx-btn-primary"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        {brand.getStarted}
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          style={{ display: "inline-flex" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M6 9l6 6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </motion.span>
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            className="lp-menu"
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <Link to="/app" role="menuitem" onClick={() => setOpen(false)}>
              <span className="lp-menu-icon">
                <IconDesk size={18} />
              </span>
              <span>
                <strong>{brand.deskLabel}</strong>
                <small>Live coverage risk and offers</small>
              </span>
            </Link>
            <Link to="/app/lab" role="menuitem" onClick={() => setOpen(false)}>
              <span className="lp-menu-icon">
                <IconBolt size={18} />
              </span>
              <span>
                <strong>{brand.labLabel}</strong>
                <small>Inject edge cases, audit decisions</small>
              </span>
            </Link>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}