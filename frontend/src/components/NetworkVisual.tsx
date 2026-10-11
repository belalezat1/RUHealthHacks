import { motion, useReducedMotion } from "framer-motion";

type Node = {
  id: string;
  x: number;
  y: number;
  risk: boolean;
  label: string;
  phy?: boolean;
};

/** Fixed layout: hospitals top row, physician pools bottom; no overlaps. */
const nodes: Node[] = [
  { id: "R", x: 18, y: 30, risk: true, label: "Riverfront" },
  { id: "L", x: 42, y: 26, risk: true, label: "Lakeside" },
  { id: "C", x: 66, y: 32, risk: false, label: "Cedar Ridge" },
  { id: "B", x: 88, y: 28, risk: false, label: "Bayview" },
  { id: "P1", x: 28, y: 72, risk: false, label: "On shift", phy: true },
  { id: "P2", x: 52, y: 78, risk: false, label: "Eligible pool", phy: true },
  { id: "P3", x: 76, y: 70, risk: false, label: "Off shift", phy: true },
];

const edges: [number, number][] = [
  [0, 4],
  [1, 4],
  [2, 5],
  [3, 4],
  [0, 5],
  [1, 5],
  [2, 6],
];

/**
 * Schematic of hospitals and the physician pools that can cover them.
 * Edges draw in once; risk is shown by colour and a static ring, never by
 * pulsing, so the map stays calm next to the clinical alert.
 */
export function NetworkVisual({ filled = false }: { filled?: boolean }) {
  const reduce = useReducedMotion();

  const fillFor = (n: Node) => {
    if (n.risk && !(filled && n.id === "R")) return "var(--rx-danger)";
    if (n.phy && n.id === "P3") return "var(--rx-text-3)";
    if (n.phy || (filled && n.id === "R")) return "var(--rx-accent)";
    return "var(--rx-text-3)";
  };
  const atRisk = (n: Node) => n.risk && !(filled && n.id === "R");

  return (
    <figure className="rx-map" style={{ margin: 0 }}>
      <svg viewBox="0 0 108 96" width="100%" height="320" role="img" aria-label="Hospital coverage network">
        {edges.map(([a, b], i) => {
          const live = filled && (a === 0 || b === 0);
          return (
            <motion.path
              key={i}
              d={`M ${nodes[a].x} ${nodes[a].y} Q ${(nodes[a].x + nodes[b].x) / 2} ${(nodes[a].y + nodes[b].y) / 2 - 8} ${nodes[b].x} ${nodes[b].y}`}
              stroke={live ? "var(--rx-accent)" : "var(--rx-line-strong)"}
              strokeWidth={live ? 1.1 : 0.7}
              fill="none"
              strokeLinecap="round"
              initial={reduce ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.7, delay: 0.05 * i, ease: [0.22, 1, 0.36, 1] }}
            />
          );
        })}
        {nodes.map((n) => (
          <g key={n.id}>
            {atRisk(n) ? (
              <circle cx={n.x} cy={n.y} r={7.5} fill="none" stroke="var(--rx-danger)" strokeOpacity={0.35} strokeWidth={0.8} />
            ) : null}
            <circle
              cx={n.x}
              cy={n.y}
              r={n.phy ? 3 : 4.2}
              fill={fillFor(n)}
              stroke="var(--rx-surface-2)"
              strokeWidth={1}
              style={{ transition: "fill 320ms cubic-bezier(0.22,1,0.36,1)" }}
            />
            <text
              x={n.x}
              y={n.y + (n.phy ? 8.5 : 11)}
              textAnchor="middle"
              fontSize="3.3"
              fill="currentColor"
              fontWeight={n.phy ? 500 : 600}
            >
              {n.label}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="rx-map-legend">
        <span>
          <i className="rx-dot critical" aria-hidden /> Below minimum coverage
        </span>
        <span>
          <i className="rx-dot" style={{ background: "var(--rx-accent)" }} aria-hidden /> Covering capacity
        </span>
        <span>
          <i className="rx-dot" style={{ background: "var(--rx-text-3)" }} aria-hidden /> Stable or off shift
        </span>
      </figcaption>
    </figure>
  );
}
