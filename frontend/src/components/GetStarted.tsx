import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { brand } from "../brand";
import { IconBolt, IconDesk } from "./Icons";

export function GetStarted() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);

  const clearClose = () => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleClose = () => {
    clearClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 140);
  };

  useEffect(() => () => clearClose(), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div
      className="gs-wrap"
      ref={ref}
      onMouseEnter={() => {
        clearClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className="btn btn-outline-nav"
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
            className="gs-menu"
            role="menu"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <Link to="/app" role="menuitem" onClick={() => setOpen(false)}>
              <IconDesk size={18} />
              <strong>{brand.deskLabel}</strong>
            </Link>
            <Link to="/app/lab" role="menuitem" onClick={() => setOpen(false)}>
              <IconBolt size={18} />
              <strong>{brand.labLabel}</strong>
            </Link>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}