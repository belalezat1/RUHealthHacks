import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";

/** Neurology hero stage: neural mesh + waveform + floating ops modules. */
export function NeuroHero() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let t = 0;
    let w = 0;
    let h = 0;

    type Branch = { x: number; y: number; a: number; len: number; w: number; hue: number };
    const branches: Branch[] = [];
    for (let i = 0; i < 28; i++) {
      branches.push({
        x: 0.35 + Math.random() * 0.45,
        y: 0.25 + Math.random() * 0.5,
        a: Math.random() * Math.PI * 2,
        len: 0.08 + Math.random() * 0.18,
        w: 1.2 + Math.random() * 2.4,
        hue: 150 + Math.random() * 40,
      });
    }

    const measure = () => {
      const rect = wrap.getBoundingClientRect();
      w = Math.max(1, Math.floor(rect.width));
      h = Math.max(1, Math.floor(rect.height));
    };

    const drawBranch = (
      x: number,
      y: number,
      a: number,
      len: number,
      depth: number,
      lw: number,
      phase: number,
    ) => {
      if (depth <= 0 || len < 0.012) return;
      const pulse = 0.45 + 0.35 * Math.sin(t * 0.002 + phase);
      const x2 = x + Math.cos(a) * len;
      const y2 = y + Math.sin(a) * len * 0.85;
      ctx.strokeStyle = `rgba(45, 212, 168, ${0.15 + pulse * 0.35})`;
      ctx.lineWidth = lw;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x * w, y * h);
      ctx.lineTo(x2 * w, y2 * h);
      ctx.stroke();

      const tipX = x2 * w;
      const tipY = y2 * h;
      const g = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, 10);
      g.addColorStop(0, `rgba(110, 231, 197, ${0.35 + pulse * 0.4})`);
      g.addColorStop(1, "transparent");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(tipX, tipY, 8, 0, Math.PI * 2);
      ctx.fill();

      drawBranch(x2, y2, a - 0.45, len * 0.62, depth - 1, lw * 0.7, phase + 0.4);
      drawBranch(x2, y2, a + 0.5, len * 0.58, depth - 1, lw * 0.7, phase + 0.8);
    };

    const drawWave = () => {
      ctx.beginPath();
      const mid = h * 0.72;
      for (let x = 0; x <= w; x += 3) {
        const n =
          Math.sin(x * 0.02 + t * 0.004) * 18 +
          Math.sin(x * 0.045 + t * 0.006) * 8 +
          Math.sin(x * 0.01 - t * 0.003) * 12;
        const y = mid + n;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "rgba(45, 212, 168, 0.55)";
      ctx.lineWidth = 2;
      ctx.shadowColor = "rgba(18, 163, 122, 0.65)";
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        const x = (w / 8) * i;
        ctx.beginPath();
        ctx.moveTo(x, h * 0.55);
        ctx.lineTo(x, h * 0.9);
        ctx.stroke();
      }
    };

    const draw = () => {
      measure();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      ctx.fillStyle = "#070908";
      ctx.fillRect(0, 0, w, h);

      const glow = ctx.createRadialGradient(w * 0.55, h * 0.4, 10, w * 0.55, h * 0.45, w * 0.55);
      glow.addColorStop(0, "rgba(18, 163, 122, 0.22)");
      glow.addColorStop(0.5, "rgba(18, 163, 122, 0.06)");
      glow.addColorStop(1, "transparent");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      const cx = w * 0.58;
      const cy = h * 0.38;
      const s = Math.min(w, h) * 0.28;
      ctx.strokeRect(cx - s, cy - s * 0.75, s * 1.5, s * 1.35);
      ctx.beginPath();
      ctx.moveTo(cx - s, cy - s * 0.75);
      ctx.lineTo(cx - s + 18, cy - s * 0.75 - 14);
      ctx.lineTo(cx - s + 18 + s * 1.5, cy - s * 0.75 - 14);
      ctx.lineTo(cx - s + s * 1.5, cy - s * 0.75);
      ctx.stroke();

      for (const b of branches) {
        const sway = reduce ? 0 : Math.sin(t * 0.0012 + b.hue) * 0.12;
        drawBranch(b.x, b.y, b.a + sway, b.len, 3, b.w, b.hue);
      }

      drawWave();

      for (let i = 0; i < 6; i++) {
        const ox = w * (0.4 + 0.08 * i) + Math.sin(t * 0.001 + i) * 6;
        const oy = h * (0.28 + (i % 3) * 0.1) + Math.cos(t * 0.0012 + i) * 5;
        const r = 4 + (i % 3);
        const og = ctx.createRadialGradient(ox, oy, 0, ox, oy, r * 3);
        og.addColorStop(0, "rgba(110, 231, 197, 0.55)");
        og.addColorStop(1, "transparent");
        ctx.fillStyle = og;
        ctx.beginPath();
        ctx.arc(ox, oy, r * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#6ee7c5";
        ctx.beginPath();
        ctx.arc(ox, oy, r, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!reduce) {
        t += 16;
        raf = requestAnimationFrame(draw);
      }
    };

    measure();
    draw();

    const ro = new ResizeObserver(() => {
      measure();
      if (reduce) draw();
    });
    ro.observe(wrap);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [reduce]);

  const float = (delay: number, y = 8) =>
    reduce
      ? {}
      : {
          animate: { y: [0, -y, 0] },
          transition: { duration: 5 + delay, repeat: Infinity, ease: "easeInOut", delay },
        };

  return (
    <div className="neuro-hero" ref={wrapRef} aria-hidden>
      <canvas ref={canvasRef} className="neuro-hero-canvas" />
      <div className="neuro-hero-labels">
        <span>Astrocytes</span>
        <span>Synapse path</span>
        <span>Coverage signal</span>
      </div>

      <motion.div className="neuro-mod neuro-mod-feed" {...float(0, 10)}>
        <p className="neuro-mod-kicker">Detection feed</p>
        <ul>
          <li>
            <span>Riverfront</span>
            <strong className="bad">Gap · 25m</strong>
          </li>
          <li>
            <span>Stroke consult</span>
            <strong>Waiting 12m</strong>
          </li>
          <li>
            <span>Synapse</span>
            <strong className="ok">Active</strong>
          </li>
        </ul>
      </motion.div>

      <motion.div className="neuro-mod neuro-mod-risk" {...float(0.6, 12)}>
        <p className="neuro-mod-kicker">Risk score</p>
        <div className="neuro-mod-score">0.91</div>
        <p className="neuro-mod-sub">Credentialed capacity shortfall</p>
      </motion.div>

      <motion.div className="neuro-mod neuro-mod-ok" {...float(1.1, 9)}>
        <p className="neuro-mod-kicker">Eligibility</p>
        <strong>Offer approved</strong>
        <p className="neuro-mod-sub">Human sign-off · Dr. Vale</p>
      </motion.div>
    </div>
  );
}
