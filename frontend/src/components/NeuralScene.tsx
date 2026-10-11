import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";

type Node = { x: number; y: number; r: number; phase: number };

const NODES: Node[] = [
  { x: 0.18, y: 0.26, r: 3.2, phase: 0.2 },
  { x: 0.32, y: 0.4, r: 3.8, phase: 1.1 },
  { x: 0.48, y: 0.24, r: 4.4, phase: 0.6 },
  { x: 0.62, y: 0.38, r: 3.0, phase: 1.7 },
  { x: 0.78, y: 0.28, r: 3.5, phase: 0.4 },
  { x: 0.28, y: 0.58, r: 2.8, phase: 1.4 },
  { x: 0.45, y: 0.55, r: 3.6, phase: 0.9 },
  { x: 0.6, y: 0.62, r: 2.9, phase: 2.1 },
  { x: 0.74, y: 0.52, r: 3.3, phase: 1.9 },
  { x: 0.38, y: 0.74, r: 2.6, phase: 0.7 },
  { x: 0.55, y: 0.78, r: 3.1, phase: 1.3 },
  { x: 0.7, y: 0.72, r: 2.7, phase: 0.5 },
];

const EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [1, 5], [2, 6], [3, 7],
  [4, 8], [5, 6], [6, 7], [7, 8], [5, 9], [6, 10], [7, 11],
  [9, 10], [10, 11], [2, 7], [1, 6],
];

export function NeuralScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let t = 0;

    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w < 2 || h < 2) {
        raf = requestAnimationFrame(draw);
        return;
      }
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, w, h);

      const bg = ctx.createRadialGradient(w * 0.5, h * 0.42, 8, w * 0.5, h * 0.5, w * 0.75);
      bg.addColorStop(0, "rgba(45,212,168,0.42)");
      bg.addColorStop(0.4, "rgba(18,163,122,0.16)");
      bg.addColorStop(1, "transparent");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      for (const [a, b] of EDGES) {
        const na = NODES[a];
        const nb = NODES[b];
        const pulse = reduce ? 0.5 : 0.35 + 0.4 * Math.sin(t * 0.0016 + na.phase);
        ctx.strokeStyle = `rgba(45,212,168,${pulse})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(na.x * w, na.y * h);
        const mx = ((na.x + nb.x) / 2) * w;
        const my = ((na.y + nb.y) / 2) * h - 12;
        ctx.quadraticCurveTo(mx, my, nb.x * w, nb.y * h);
        ctx.stroke();
      }

      for (const n of NODES) {
        const glow = reduce ? 1.2 : 1.2 + 0.55 * Math.sin(t * 0.002 + n.phase);
        const x = n.x * w + (reduce ? 0 : Math.sin(t * 0.0009 + n.phase) * 3);
        const y = n.y * h + (reduce ? 0 : Math.cos(t * 0.0008 + n.phase) * 3);
        const rg = ctx.createRadialGradient(x, y, 0, x, y, n.r * 7 * glow);
        rg.addColorStop(0, "rgba(45,212,168,0.9)");
        rg.addColorStop(0.45, "rgba(18,163,122,0.35)");
        rg.addColorStop(1, "transparent");
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(x, y, n.r * 7 * glow, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#6ee7c5";
        ctx.beginPath();
        ctx.arc(x, y, n.r * 1.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ecfdf5";
        ctx.beginPath();
        ctx.arc(x, y, n.r * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!reduce) {
        t += 16;
        raf = requestAnimationFrame(draw);
      }
    };

    draw();
    const onResize = () => {
      if (reduce) draw();
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [reduce]);

  return (
    <div className="neural-scene" aria-hidden>
      <canvas ref={canvasRef} />
      <div className="neural-labels">
        <span>Coverage graph</span>
        <span>Credential mesh</span>
        <span>Consult path</span>
      </div>
    </div>
  );
}
