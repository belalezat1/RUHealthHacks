import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Reveal } from "./Reveal";
import { motion, useReducedMotion } from "framer-motion";

export const EASE = [0.22, 1, 0.36, 1] as const;

/* Card ------------------------------------------------------------------ */

type CardProps = {
  title?: ReactNode;
  icon?: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
  /** Position in the page, used to stagger cards that enter view together. */
  index?: number;
  bodyClassName?: string;
  footer?: ReactNode;
};

export function Card({
  title,
  icon,
  count,
  actions,
  children,
  className = "",
  id,
  index,
  bodyClassName = "rx-card-body",
  footer,
}: CardProps) {
  const headingId = useId();
  return (
    <Reveal
      as="section"
      id={id}
      className={`rx-card${id ? " rx-section" : ""} ${className}`.trim()}
      delay={index != null ? (index % 3) * 0.06 : 0}
      aria-labelledby={title ? headingId : undefined}
    >
      {title ? (
        <header className="rx-card-head">
          <div className="rx-card-title">
            {icon ? <span className="rx-card-icon">{icon}</span> : null}
            <div>
              <h2 id={headingId}>
                {title}
                {count != null ? <span className="rx-card-count">{count}</span> : null}
              </h2>
            </div>
          </div>
          {actions}
        </header>
      ) : null}
      <div className={bodyClassName}>{children}</div>
      {footer ? <div className="rx-card-foot">{footer}</div> : null}
    </Reveal>
  );
}

/** "in_progress" → "In progress": labels in sentence case, never Title Case. */
export function sentence(raw: string) {
  const t = raw.replace(/_/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/* Pill ------------------------------------------------------------------ */

export type Tone = "critical" | "caution" | "ok" | "accent" | "muted";

export function Pill({ tone = "muted", dot, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`rx-pill${tone === "muted" ? "" : ` rx-pill-${tone}`}`}>
      {dot ? <i aria-hidden /> : null}
      {children}
    </span>
  );
}

/* Avatar ---------------------------------------------------------------- */

export function initials(name: string) {
  return name
    .replace(/^Dr\.?\s+/i, "")
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function Avatar({ name, seed }: { name: string; seed?: string }) {
  const key = seed ?? name;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return (
    <span className={`rx-avatar h${h % 5}`} aria-hidden>
      {initials(name)}
    </span>
  );
}

/* Folder tabs ------------------------------------------------------------- */

export type TabDef<T extends string> = { id: T; label: ReactNode; badge?: ReactNode };

/**
 * WAI-ARIA tabs with roving focus. The active tab's surface slides between
 * tabs and merges into the card below, like a file folder.
 */
export function FolderTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  idBase,
}: {
  tabs: TabDef<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  idBase: string;
}) {
  const reduce = useReducedMotion();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: KeyboardEvent, i: number) => {
    const last = tabs.length - 1;
    const next =
      e.key === "ArrowRight" ? (i === last ? 0 : i + 1)
      : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next == null) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(tabs[next].id);
  };

  return (
    <div className="rx-foldertabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${idBase}-tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`${idBase}-panel`}
            tabIndex={selected ? 0 : -1}
            className="rx-foldertab"
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {selected ? (
              <motion.span
                layoutId={reduce ? undefined : `${idBase}-tabbg`}
                className="rx-foldertab-bg"
                transition={{ duration: 0.28, ease: EASE }}
              />
            ) : null}
            {t.label}
            {t.badge}
          </button>
        );
      })}
    </div>
  );
}

/* Segmented control ------------------------------------------------------ */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  idBase,
  disabled,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  idBase: string;
  disabled?: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <div className="rx-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            className="rx-seg-btn"
            disabled={disabled}
            onClick={() => onChange(o.value)}
          >
            {on ? (
              <motion.span
                layoutId={reduce ? undefined : `${idBase}-seg`}
                className="rx-seg-pill"
                transition={{ duration: 0.25, ease: EASE }}
              />
            ) : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* Workflow: Detect → Decide → Act --------------------------------------- */

export type FlowStage = 0 | 1 | 2 | 3;

export function WorkflowSteps({ stage }: { stage: FlowStage }) {
  const steps = ["Detect", "Decide", "Act"];
  return (
    <ol className="rx-flow" aria-label="Workflow progress">
      {steps.map((s, i) => {
        const state = i < stage ? "is-done" : i === stage ? "is-current" : "";
        return (
          <li key={s} className={state} aria-current={i === stage ? "step" : undefined}>
            <span className="rx-flow-mark">{i < stage ? "✓" : i + 1}</span>
            {s}
          </li>
        );
      })}
    </ol>
  );
}
