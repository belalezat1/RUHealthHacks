import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { brand, FAQ } from "../brand";
import { RelayMark } from "../components/RelayMark";
import { GetStarted } from "../components/GetStarted";
import { HeroStage } from "../components/HeroStage";
import { Reveal } from "../components/Reveal";
import { IconChevron } from "../components/Icons";
import { ThemeToggle, useTheme } from "../theme";

const STEPS = [
  {
    word: "Detect",
    body: "Forecast credentialed neurology capacity against consult demand, 90 minutes ahead in 15-minute slots.",
  },
  {
    word: "Decide",
    body: "Rank eligible physicians using verified operational evidence. Every hard rule is shown as pass or fail, never hidden in a score.",
  },
  {
    word: "Act",
    body: "A clinical lead approves, the offer goes out without patient data, and the physician responds through their own account.",
  },
] as const;

/** Advances Detect → Decide → Act every few seconds; frozen at Detect for reduced motion. */
function useCycle() {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => setI((n) => (n + 1) % brand.cycle.length), 3200);
    return () => window.clearInterval(id);
  }, [reduce]);
  return reduce ? 0 : i;
}

function CycleWords({ index }: { index: number }) {
  const reduce = useReducedMotion();
  const word = brand.cycle[index];
  return (
    <h1 className="lp-cycle">
      <span className="sr-only">Detect. Decide. Act.</span>
      <span aria-hidden className="lp-cycle-word">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={word}
            initial={reduce ? false : { y: "70%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduce ? undefined : { y: "-70%", opacity: 0 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            style={{ display: "block" }}
          >
            {word}
          </motion.span>
        </AnimatePresence>
      </span>
    </h1>
  );
}

function HowItWorks({ active }: { active: number }) {
  return (
    <Reveal className="lp-section lp-how" aria-labelledby="how-title">
      <h2 id="how-title">{brand.capabilityHeadline}</h2>
      <ol className="lp-steps">
        {STEPS.map((step, i) => (
          <Reveal as="li" key={step.word} className={i === active ? "is-active" : ""} delay={i * 0.1}>
            <span className="lp-step-n num">{i + 1}</span>
            <h3>{step.word}</h3>
            <p>{step.body}</p>
          </Reveal>
        ))}
      </ol>
    </Reveal>
  );
}

function FaqSection() {
  const [open, setOpen] = useState<number | null>(null);
  const reduce = useReducedMotion();

  return (
    <Reveal className="lp-section lp-faq" aria-labelledby="faq-title">
      <div className="lp-faq-intro">
        <h2 id="faq-title">{brand.faqTitle}</h2>
        <a className="rx-btn rx-btn-secondary" href={`mailto:${brand.reachOutEmail}`}>
          {brand.reachOutLabel}
        </a>
      </div>
      <div className="lp-faq-list">
        {FAQ.map((item, i) => {
          const isOpen = open === i;
          return (
            <Reveal as="div" className={`lp-faq-item${isOpen ? " is-open" : ""}`} key={item.q} delay={i * 0.08}>
              <button
                type="button"
                className="lp-faq-q"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : i)}
              >
                <span>{item.q}</span>
                <span className="lp-faq-icon" aria-hidden>
                  <IconChevron size={16} />
                </span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen ? (
                  <motion.div
                    key="a"
                    className="lp-faq-a"
                    initial={reduce ? false : { height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={reduce ? undefined : { height: 0, opacity: 0 }}
                    transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <p>{item.a}</p>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </Reveal>
          );
        })}
      </div>
    </Reveal>
  );
}

function MissionStrip() {
  return (
    <Reveal className="lp-section lp-mission" aria-labelledby="mission-title">
      <h2 id="mission-title">{brand.missionHeadline}</h2>
      <p>{brand.missionBody}</p>
      <ul className="lp-tags">
        {brand.missionTags.map((tag) => (
          <li key={tag}>{tag}</li>
        ))}
      </ul>
    </Reveal>
  );
}

function FooterContact() {
  const [email, setEmail] = useState("");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    const subject = encodeURIComponent("Relay demo contact");
    const body = encodeURIComponent(`From: ${trimmed}\n\nI'd like to learn more about Relay.`);
    window.location.href = `mailto:${brand.reachOutEmail}?subject=${subject}&body=${body}`;
  };

  return (
    <form className="lp-contact" onSubmit={onSubmit}>
      <label className="sr-only" htmlFor="footer-email">
        Email
      </label>
      <div className="lp-contact-row">
        <input
          id="footer-email"
          type="email"
          required
          placeholder="you@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
        <button type="submit" className="rx-btn rx-btn-primary rx-btn-sm" aria-label="Send contact">
          Contact
        </button>
      </div>
      <p className="lp-contact-note">Demo contact. No spam.</p>
    </form>
  );
}

export default function Landing() {
  const reduce = useReducedMotion();
  const { theme } = useTheme();
  const stage = useCycle() as 0 | 1 | 2;
  const rise = (delay: number) =>
    reduce
      ? {}
      : {
          initial: { y: 16, opacity: 0 },
          animate: { y: 0, opacity: 1 },
          transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] as const },
        };

  return (
    <div className="rx-site" data-theme={theme}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="lp-nav">
        <div className="lp-wrap lp-nav-inner">
          <RelayMark size="nav" />
          <div className="lp-nav-actions">
            <ThemeToggle />
            <GetStarted />
          </div>
        </div>
      </header>

      <main id="main">
        <section className="lp-wrap lp-hero">
          <div className="lp-hero-copy">
            <motion.div {...rise(0.12)}>
              <CycleWords index={stage} />
            </motion.div>
            <motion.p className="lp-slogan" {...rise(0.2)}>
              {brand.slogan}
            </motion.p>
            <motion.div className="lp-cta" {...rise(0.32)}>
              <Link to="/app" className="rx-btn rx-btn-primary rx-btn-lg">
                {brand.ctaPrimary}
                <span className="rx-btn-arrow" aria-hidden>
                  →
                </span>
              </Link>
              <Link to="/app/lab" className="rx-btn rx-btn-secondary rx-btn-lg">
                Try the {brand.labLabel.toLowerCase()}
              </Link>
            </motion.div>
          </div>
          <motion.div {...rise(0.2)}>
            <HeroStage stage={stage} />
          </motion.div>
        </section>

        <div className="lp-wrap">
          <HowItWorks active={stage} />
          <MissionStrip />
          <FaqSection />
        </div>
      </main>

      <Reveal as="footer" className="lp-footer">
        <div className="lp-wrap lp-footer-inner">
          <div className="lp-footer-brand">
            <RelayMark size="sm" href={null} />
            <p>{brand.disclaimer}</p>
          </div>
          <FooterContact />
        </div>
      </Reveal>
    </div>
  );
}
