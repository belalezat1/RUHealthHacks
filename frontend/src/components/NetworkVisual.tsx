import { motion, useReducedMotion } from "framer-motion";

const nodes = [
  { id: "R", x: 22, y: 38, risk: true, label: "Riverfront" },
  { id: "L", x: 42, y: 22, risk: true, label: "Lakeside" },
  { id: "C", x: 62, y: 46, risk: false, label: "Cedar" },
  { id: "B", x: 80, y: 28, risk: false, label: "Bayview" },
  { id: "P1", x: 34, y: 70, risk: false, label: "On shift", phy: true },
  { id: "P2", x: 56, y: 76, risk: false, label: "Eligible", phy: true },
  { id: "P3", x: 74, y: 64, risk: false, label: "Off shift", phy: true },
];

const edges = [
  [0, 4],
  [1, 4],
  [2, 5],
  [3, 4],
  [0, 5],
  [1, 5],
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
      className={schematic ? "map-board" : "hero-stage"}
      aria-label="Hospital coverage network"
      style={schematic ? undefined : { minHeight: 420 }}
    >
      {schematic ? <div className="map-label">Coverage hall · next 90 minutes</div> : null}
      <svg
        viewBox="0 0 100 100"
        width="100%"
        height={schematic ? "360" : "100%"}
        role="img"
        style={{ position: "relative", zIndex: 1 }}
      >
        <defs>
          <radialGradient id="glow" cx="50%" cy="50%" r="50%">
            <stop
              offset="0%"
              stopColor={filled ? "#2f9e8f" : "#e11d48"}
              stopOpacity="0.35"
            />
            <stop
              offset="100%"
              stopColor={filled ? "#2f9e8f" : "#e11d48"}
              stopOpacity="0"
            />
          </radialGradient>
        </defs>
        {edges.map(([a, b], i) => (
          <path
            key={i}
            d={`M ${nodes[a].x} ${nodes[a].y} Q ${(nodes[a].x + nodes[b].x) / 2} ${(nodes[a].y + nodes[b].y) / 2 - 6} ${nodes[b].x} ${nodes[b].y}`}
            stroke={filled ? "#7ec8b8" : "rgba(26,31,44,0.14)"}
            strokeWidth="0.9"
            fill="none"
            strokeLinecap="round"
          />
        ))}
        {nodes.map((n) => (
          <g key={n.id}>
            {(n.risk && !filled) || (n.id === "R" && filled) ? (
              <motion.circle
                cx={n.x}
                cy={n.y}
                r={9}
                fill="url(#glow)"
                animate={
                  reduce
                    ? undefined
                    : { r: [8, 11, 8], opacity: [0.45, 0.9, 0.45] }
                }
                transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
              />
            ) : null}
            <circle
              cx={n.x}
              cy={n.y}
              r={n.phy ? 3 : 4}
              fill={
                filled && n.id === "R"
                  ? "#2f9e8f"
                  : n.risk
                    ? "#e11d48"
                    : n.phy
                      ? "#2f9e8f"
                      : "#1a1f2c"
              }
            />
            <text
              x={n.x}
              y={n.y + 8}
              textAnchor="middle"
              fontSize="3"
              fill="#6b7280"
              fontFamily="IBM Plex Sans, sans-serif"
            >
              {n.label}
            </text>
          </g>
        ))}
      </svg>
      {!schematic ? (
        <div style={{ position: "absolute", left: 22, bottom: 18, right: 22, zIndex: 2 }}>
          <div style={{ fontWeight: 700, letterSpacing: "-0.02em" }}>
            {filled
              ? "Gap filled — offers stopped"
              : "Coverage gap forming at Riverfront"}
          </div>
          <div style={{ color: "var(--ink-muted)", fontSize: 14, marginTop: 4 }}>
            {filled
              ? "Projected capacity meets the minimum for the next 90 minutes."
              : "Shift end in 35 minutes · credentialed capacity drops below minimum."}
          </div>
        </div>
      ) : null}
    </div>
  );
}