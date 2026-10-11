import { useId } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { brand } from "../brand";

type Props = {
  size?: "nav" | "hero" | "sm";
  href?: string | null;
};

const EASE = [0.22, 1, 0.36, 1] as const;

/** Node centres and radii in the glyph's 720×570 drawing space. */
const NODES = [
  { cx: 345, cy: 445, r: 61, fill: "var(--logo-node-a)" },
  { cx: 915, cy: 603, r: 58, fill: "var(--logo-node-a)" },
  { cx: 857, cy: 835, r: 60, fill: "var(--logo-node-b)" },
];
/** Clear space between a node and the routes that meet it. */
const GAP = 16;

/**
 * The Relay mark: two routes that hand off between three nodes. The gaps
 * around each node are cut with a mask, so they stay transparent on any
 * background in either theme.
 */
export function RelayGlyph({ size = 28 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  const reduce = useReducedMotion();
  const draw = (delay: number) =>
    reduce
      ? {}
      : {
          initial: { pathLength: 0 },
          animate: { pathLength: 1 },
          transition: { duration: 0.9, delay, ease: EASE },
        };
  const pop = (delay: number) =>
    reduce
      ? {}
      : {
          initial: { scale: 0 },
          animate: { scale: 1 },
          transition: { duration: 0.45, delay, ease: EASE },
        };

  return (
    <svg
      className="relay-glyph"
      width={size}
      height={size * (570 / 720)}
      viewBox="270 340 720 570"
      fill="none"
      aria-hidden
    >
      <defs>
        <mask id={`${id}-cut`} maskUnits="userSpaceOnUse" x="270" y="340" width="720" height="570">
          <rect x="270" y="340" width="720" height="570" fill="#fff" />
          {NODES.map((n) => (
            <circle key={n.cx} cx={n.cx} cy={n.cy} r={n.r + GAP} fill="#000" />
          ))}
        </mask>
      </defs>
      <g mask={`url(#${id}-cut)`} stroke="var(--logo-stroke)" strokeLinejoin="round">
        <motion.path d="M330 399 H800 A125 125 0 0 1 925 524 V600" strokeWidth={82} {...draw(0)} />
        <motion.path
          d="M395 548 H580 A102 102 0 0 1 682 650 V690 C682 735 704 763 740 787 L860 862"
          strokeWidth={74}
          strokeLinecap="round"
          {...draw(0.12)}
        />
        <motion.path d="M690 643 H900" strokeWidth={64} {...draw(0.3)} />
      </g>
      {NODES.map((n, i) => (
        <motion.circle
          key={n.cx}
          className="relay-node"
          cx={n.cx}
          cy={n.cy}
          r={n.r}
          fill={n.fill}
          style={{ transformOrigin: `${n.cx}px ${n.cy}px` }}
          {...pop(0.45 + i * 0.12)}
        />
      ))}
    </svg>
  );
}

export function RelayMark({ size = "nav", href = "/" }: Props) {
  const fs = size === "hero" ? "2.85rem" : size === "sm" ? "1.2rem" : "1.55rem";
  const glyph = size === "hero" ? 64 : size === "sm" ? 30 : 40;

  const inner = (
    <span className={`relay-mark relay-mark-${size}`}>
      <span className="relay-mark-icon">
        <RelayGlyph size={glyph} />
      </span>
      <span className="relay-wordmark" style={{ fontSize: fs }}>
        {brand.name}
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
