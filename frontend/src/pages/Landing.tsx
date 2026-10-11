import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { NetworkVisual } from "../components/NetworkVisual";
import { useDemo } from "../demo/store";

export default function Landing() {
  const reduce = useReducedMotion();
  const { offerStep } = useDemo();
  const filled = offerStep === "filled" || offerStep === "accepted";

  const fade = (delay: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 12 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.55,
            delay,
            ease: [0.22, 1, 0.36, 1] as const,
          },
        };

  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="logo-pixel">
          sevaro<em>.</em> command
        </div>
        <Link to="/app" className="btn btn-ghost">
          Open desk
        </Link>
      </header>

      <section className="landing-hero">
        <div className="landing-copy">
          <motion.p
            {...fade(0)}
            style={{ color: "var(--ink-faint)", margin: "0 0 12px", fontSize: 13, fontWeight: 600 }}
          >
            RUTGERS HEALTH HACK 2026 · TELE-NEUROLOGY OPS
          </motion.p>
          <motion.h1 {...fade(0.08)}>Sevaro Command Center</motion.h1>
          <motion.p className="slogan" {...fade(0.16)}>
            See the gap. Fill it before the consult waits.
          </motion.p>
          <motion.p className="support" {...fade(0.24)}>
            Stroke-aware coverage operations: detect risk across hospitals, decide
            with explainable eligibility, act only after clinical lead approval.
          </motion.p>
          <motion.div className="cta-row" {...fade(0.32)}>
            <Link to="/app" className="btn btn-primary">
              Open the command center
            </Link>
            <span style={{ color: "var(--ink-muted)", fontSize: 14 }}>
              First value in under 60 seconds
            </span>
          </motion.div>
        </div>
        <motion.div {...fade(0.2)}>
          <NetworkVisual filled={filled} />
        </motion.div>
      </section>

      <section className="process" aria-label="How it works">
        <article>
          <h3>1. Detect</h3>
          <p>
            Live state from the event stream. Flag demand spikes, shift endings, and
            capacity drops across 90 minutes.
          </p>
        </article>
        <article>
          <h3>2. Decide</h3>
          <p>
            Hard eligibility first. Every off-shift physician shows pass or fail —
            including the split-shift trap.
          </p>
        </article>
        <article>
          <h3>3. Act</h3>
          <p>
            Propose, approve, send, resolve. Offers stop when the gap is filled. Full
            audit of who was considered.
          </p>
        </article>
      </section>

      <footer className="landing-foot">
        Synthetic data · Tuesday 17 March 2026 · Now 18:20 ET · No patient information
      </footer>
    </div>
  );
}