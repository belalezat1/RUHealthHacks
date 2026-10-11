import { useId } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { brand } from "../brand";

type Props = {
  size?: "nav" | "hero" | "sm";
  href?: string | null;
};

const EASE = [0.22, 1, 0.36, 1] as const;

/** The Relay "R": a routed line that hands off between three nodes. */
export function RelayGlyph({ size = 28 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  const reduce = useReducedMotion();
  const draw = (delay: number) =>
    reduce
      ? {}
      : {
          initial: { pathLength: 0, opacity: 0 },
          animate: { pathLength: 1, opacity: 1 },
          transition: { duration: 0.9, delay, ease: EASE },
        };
  const pop = (delay: number) =>
    reduce
      ? {}
      : {
          initial: { scale: 0, opacity: 0 },
          animate: { scale: 1, opacity: 1 },
          transition: { duration: 0.45, delay, ease: EASE },
        };

  return (
    <svg
      className="relay-glyph"
      width={size}
      height={size * (41 / 47)}
      viewBox="0 0 47 41"
      fill="none"
      aria-hidden
    >
      <defs>
        <linearGradient id={`${id}-tail`} x1="3" y1="0" x2="26" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--logo)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--logo)" />
        </linearGradient>
        <linearGradient id={`${id}-loop`} x1="0" y1="16" x2="0" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--logo)" stopOpacity="0.55" />
          <stop offset="1" stopColor="var(--logo)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.path
        d="M41.8 11.3C41.8 16.5 38.5 19.5 33.5 19.5C28.5 19.5 25 23.5 25 28.5V34"
        stroke={`url(#${id}-loop)`}
        strokeWidth="3.6"
        strokeLinecap="round"
        {...draw(0.35)}
      />
      <motion.path
        d="M3 4.5H35C39 4.5 41.8 7.3 41.8 11.3"
        stroke={`url(#${id}-tail)`}
        strokeWidth="3.6"
        strokeLinecap="round"
        {...draw(0.05)}
      />
      <motion.path
        d="M5.5 18H19.5C21.5 18 23 18.8 24.3 20.3L37.5 35.3"
        stroke="var(--logo)"
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...draw(0.2)}
      />
      {[
        [5.5, 18, 0.15],
        [41.8, 11.3, 0.5],
        [37.5, 35.3, 0.7],
      ].map(([cx, cy, delay]) => (
        <motion.circle
          key={`${cx}-${cy}`}
          className="relay-node"
          cx={cx}
          cy={cy}
          r="3.7"
          fill="var(--logo-node)"
          style={{ transformOrigin: `${cx}px ${cy}px` }}
          {...pop(delay)}
        />
      ))}
    </svg>
  );
}

export function RelayMark({ size = "nav", href = "/" }: Props) {
  const fs = size === "hero" ? "2.85rem" : size === "sm" ? "1.2rem" : "1.6rem";
  const tile = size === "hero" ? 52 : size === "sm" ? 28 : 38;

  const inner = (
    <span className={`relay-mark relay-mark-${size}`}>
      <span className="relay-mark-icon" style={{ width: tile, height: tile }}>
        <RelayGlyph size={Math.round(tile * 0.66)} />
      </span>
      <span className="relay-wordmark" style={{ fontSize: fs }}>
        {brand.nameLower}
      </span>
    </span>
  );

  if (href === null) return inner;
  return (
    <Link to={href} className="relay-mark-link" aria-label={`${brand.name} home`}>
      {inner}
    </Link>
  );
}
