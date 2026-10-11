import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion, useScroll, useSpring } from "framer-motion";
import { RelayMark } from "../RelayMark";
import {
  IconArrowLeft,
  IconBell,
  IconBolt,
  IconDesk,
  IconMenu,
  IconSearch,
  IconX,
} from "../Icons";
import { EASE } from "../ui";
import { ConfirmationToast } from "./ConfirmationToast";
import { useDemo } from "../../demo/store";
import { usePressRipple } from "../../lib/ripple";
import { clock } from "../../lib/format";
import { brand } from "../../brand";
import { ThemeToggle, useTheme } from "../../theme";

export const DESK_SECTIONS = [
  { id: "forecast", label: "Coverage forecast" },
  { id: "physicians", label: "Physicians" },
  { id: "consults", label: "Consult queue" },
  { id: "interventions", label: "Interventions" },
] as const;

/** Highlights the desk section currently in view. */
function useActiveSection(enabled: boolean) {
  const [active, setActive] = useState<string>(DESK_SECTIONS[0].id);
  useEffect(() => {
    if (!enabled) return;
    const els = DESK_SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => el != null,
    );
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-30% 0px -55% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [enabled]);
  return active;
}

function useScrolled(threshold = 4) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);
  return scrolled;
}

function greeting(iso: string) {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    }).format(new Date(iso)),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function SearchField() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const set = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set("q", value);
    else next.delete("q");
    setParams(next, { replace: true });
  };
  return (
    <div className="rx-search" role="search">
      <IconSearch size={17} />
      <input
        type="search"
        value={q}
        onChange={(e) => set(e.target.value)}
        placeholder="Search physicians, hospitals, consults…"
        aria-label="Filter physicians and consults"
      />
      {q ? (
        <button type="button" className="rx-search-clear" aria-label="Clear search" onClick={() => set("")}>
          <IconX size={15} />
        </button>
      ) : null}
    </div>
  );
}

function Notifications() {
  const { events } = useDemo();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(events.length);
  const ref = useRef<HTMLDivElement>(null);
  const unread = Math.max(0, events.length - seen);

  useEffect(() => {
    if (!open) return;
    setSeen(events.length);
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, events.length]);

  return (
    <div className="rx-popover-anchor" ref={ref}>
      <button
        type="button"
        className="rx-icon-btn"
        aria-label={unread ? `Activity, ${unread} new` : "Activity"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
      >
        <IconBell size={18} />
        <AnimatePresence>
          {unread ? (
            <motion.span
              className="rx-badge-dot"
              initial={reduce ? false : { scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ duration: 0.2, ease: EASE }}
            >
              {unread}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            className="rx-popover"
            role="dialog"
            aria-label="Recent activity"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -4 }}
            transition={{ duration: 0.18, ease: EASE }}
          >
            <div className="rx-popover-head">
              Activity <span>{events.length} events</span>
            </div>
            <ul className="rx-popover-list">
              {events.slice(0, 8).map((e, i) => (
                <li key={e.id} className={i < unread ? "is-new" : ""}>
                  <i aria-hidden />
                  <span>{e.text}</span>
                  <time dateTime={e.at}>{clock(e.at)}</time>
                </li>
              ))}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function AppShell() {
  const { theme } = useTheme();
  const { dashboard } = useDemo();
  const location = useLocation();
  const reduce = useReducedMotion();
  const isLab = location.pathname.startsWith("/app/lab");
  const scrolled = useScrolled();
  const active = useActiveSection(!isLab);
  const [navOpen, setNavOpen] = useState(false);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 260, damping: 34, mass: 0.3 });
  usePressRipple();

  useEffect(() => setNavOpen(false), [location.pathname]);
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setNavOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navOpen]);

  const scrollTo = (id: string) => {
    setNavOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };


  return (
    <div className="rx" data-theme={theme}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <aside className={`rx-side${navOpen ? " is-open" : ""}`} aria-label="Sidebar">
        <div className="rx-side-brand">
          <RelayMark size="nav" href="/" />
        </div>

        <div className="rx-operator">
          <span className="rx-avatar h0" aria-hidden>
            HO
          </span>
          <div>
            <strong>Harbor operations</strong>
            <span>Ops coordinator · synthetic demo</span>
          </div>
        </div>

        <nav className="rx-nav" aria-label="Primary">
          <NavLink to="/app" end className={({ isActive }) => `rx-nav-item${isActive ? " is-active" : ""}`}>
            {({ isActive }) => (
              <>
                {isActive ? (
                  <motion.span
                    layoutId={reduce ? undefined : "rx-nav-pill"}
                    className="rx-nav-pill"
                    transition={{ duration: 0.3, ease: EASE }}
                  />
                ) : null}
                <IconDesk size={18} />
                {brand.deskLabel}
              </>
            )}
          </NavLink>
          <AnimatePresence initial={false}>
            {!isLab ? (
              <motion.div
                className="rx-nav-sub"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: EASE }}
              >
                {DESK_SECTIONS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`rx-nav-subitem${active === s.id ? " is-current" : ""}`}
                    aria-current={active === s.id ? "location" : undefined}
                    onClick={() => scrollTo(s.id)}
                  >
                    <i aria-hidden />
                    {s.label}
                  </button>
                ))}
              </motion.div>
            ) : null}
          </AnimatePresence>
          <NavLink to="/app/lab" className={({ isActive }) => `rx-nav-item${isActive ? " is-active" : ""}`}>
            {({ isActive }) => (
              <>
                {isActive ? (
                  <motion.span
                    layoutId={reduce ? undefined : "rx-nav-pill"}
                    className="rx-nav-pill"
                    transition={{ duration: 0.3, ease: EASE }}
                  />
                ) : null}
                <IconBolt size={18} />
                {brand.labLabel}
              </>
            )}
          </NavLink>
        </nav>

        <div className="rx-side-foot">
          <div className="rx-theme-row">
            {theme === "light" ? "Light mode" : "Dark mode"}
            <ThemeToggle className="rx-icon-btn-sm" />
          </div>
          <Link to="/" className="rx-nav-item">
            <IconArrowLeft size={18} />
            Back to site
          </Link>
        </div>
      </aside>

      <AnimatePresence>
        {navOpen ? (
          <motion.button
            type="button"
            className="rx-scrim"
            style={{ zIndex: 65 }}
            aria-label="Close navigation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setNavOpen(false)}
          />
        ) : null}
      </AnimatePresence>

      <div className="rx-main">
        <header className={`rx-header${scrolled ? " is-scrolled" : ""}`}>
          <button
            type="button"
            className="rx-icon-btn rx-menu-btn"
            aria-label="Open navigation"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(true)}
          >
            <IconMenu size={18} />
          </button>
          <div className="rx-header-title">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={isLab ? "lab" : "desk"}
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: -6 }}
                transition={{ duration: 0.2, ease: EASE }}
              >
                <h1>{isLab ? brand.labLabel : `${greeting(dashboard.as_of)}, Harbor ops`}</h1>
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="rx-header-actions">
            {!isLab ? <SearchField /> : null}
            <Notifications />
            <ThemeToggle />
          </div>
          {scrolled ? <motion.div className="rx-scroll-progress" style={{ scaleX: progress }} aria-hidden /> : null}
        </header>

        <motion.main
          id="main"
          key={location.pathname}
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE }}
        >
          <Outlet />
        </motion.main>
        <ConfirmationToast />
      </div>
    </div>
  );
}
