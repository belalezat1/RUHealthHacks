import { motion, useReducedMotion } from "framer-motion";

type Node = {
  id: string;
  x: number;
  y: number;
  risk: boolean;
  label: string;
  phy?: boolean;
};

/** Fixed layout: hospitals top row, physicians bottom; no overlaps */
const nodes: Node[] = [
  { id: "R", x: 18, y: 32, risk: true, label: "Riverfront" },
  { id: "L", x: 42, y: 28, risk: true, label: "Lakeside" },
  { id: "C", x: 66, y: 34, risk: false, label: "Cedar" },
  { id: "B", x: 88, y: 30, risk: false, label: "Bayview" },
  { id: "P1", x: 28, y: 72, risk: false, label: "On shift", phy: true },
  { id: "P2", x: 52, y: 78, risk: false, label: "Eligible", phy: true },
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

export function NetworkVisual({
  filled = false,
  schematic = false,
}: {
  filled?: boolean;
  schematic?: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <div
      className={schematic ? "map-board" : "panel"}
      aria-label="Hospital coverage network"
      style={schematic ? undefined : { minHeight: 420, position: "relative" }}
    >
      {schematic ? <div className="map-label">Coverage hall · next 90 minutes</div> : null}
      <svg
        viewBox="0 0 108 100"
        width="100%"
        height={schematic ? "300" : "100%"}
        role="img"
        style={{ position: "relative", zIndex: 1, marginTop: schematic ? 18 : 0 }}
      >
        <defs>
          <radialGradient id="nodeGlow" cx="50%" cy="50%" r="50%">
            <stop
              offset="0%"
              stopColor={filled ? "#12a37a" : "#e11d48"}
              stopOpacity="0.45"
            />
            <stop
              offset="100%"
              stopColor={filled ? "#12a37a" : "#e11d48"}
              stopOpacity="0"
            />
          </radialGradient>
        </defs>
        {edges.map(([a, b], i) => (
          <path
            key={i}
            d={`M ${nodes[a].x} ${nodes[a].y} Q ${(nodes[a].x + nodes[b].x) / 2} ${(nodes[a].y + nodes[b].y) / 2 - 8} ${nodes[b].x} ${nodes[b].y}`}
            stroke={filled ? "rgba(18,163,122,0.45)" : "rgba(128,128,128,0.35)"}
            strokeWidth="0.85"
            fill="none"
            strokeLinecap="round"
          />
        ))}
        {nodes.map((n) => {
          const atRisk = n.risk && !filled;
          const healthy = (filled && n.id === "R") || (n.phy && n.id !== "P3");
          return (
            <g key={n.id}>
              {atRisk || (n.id === "R" && filled) ? (
                <motion.circle
                  cx={n.x}
                  cy={n.y}
                  r={10}
                  fill="url(#nodeGlow)"
                  animate={
                    reduce
                      ? undefined
                      : { r: [9, 12, 9], opacity: [0.4, 0.85, 0.4] }
                  }
                  transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
                />
              ) : null}
              <circle
                cx={n.x}
                cy={n.y}
                r={n.phy ? 3.2 : 4.2}
                fill={
                  atRisk
                    ? "#e11d48"
                    : healthy
                      ? "#12a37a"
                      : n.phy
                        ? "#8a8a8a"
                        : "#5c5c5c"
                }
              />
              <text
                x={n.x}
                y={n.y + (n.phy ? 9 : 11)}
                textAnchor="middle"
                fontSize="3.2"
                fill="currentColor"
                opacity="0.7"
                fontFamily="DM Sans, sans-serif"
              >
                {n.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}