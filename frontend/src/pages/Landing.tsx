import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { brand, FAQ, PARTNER_LOGOS } from "../brand";
import { RelayMark } from "../components/RelayMark";
import { GetStarted } from "../components/GetStarted";
import { HeroStage } from "../components/HeroStage";

function CycleWords() {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => {
      setI((n) => (n + 1) % brand.cycle.length);
    }, 3200);
    return () => window.clearInterval(id);
  }, [reduce]);

  const word = brand.cycle[reduce ? 0 : i];

  return (
    <h1 aria-live="polite" className="cycle-heading">
      <span className="sr-only">Detect. Decide. Act.</span>
      <span aria-hidden className="cycle-word">
        <AnimatePresence mode="wait">
          <motion.span
            key={word}
            initial={reduce ? false : { y: "80%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduce ? undefined : { y: "-80%", opacity: 0 }}
            transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
            style={{ display: "block" }}
          >
            {word}
          </motion.span>
        </AnimatePresence>
      </span>
    </h1>
  );
}

function FaqSection() {
  const [open, setOpen] = useState<number | null>(null);
  const reduce = useReducedMotion();

  return (
    <section className="faq-section" aria-labelledby="faq-title">
      <div className="faq-left">
        <h2 id="faq-title">{brand.faqTitle}</h2>
        <p>{brand.faqTouch}</p>
        <a className="btn btn-primary faq-reach-btn" href={`mailto:${brand.reachOutEmail}`}>
          {brand.reachOutLabel}
        </a>
      </div>
      <div className="faq-right">
        {FAQ.map((item, i) => {
          const isOpen = open === i;
          return (
            <div className="faq-item" key={item.q}>
              <button
                type="button"
                className="faq-q"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : i)}
              >
                <span>{item.q}</span>
                <motion.span
                  animate={{ rotate: isOpen ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                  aria-hidden
                >
                  ▾
                </motion.span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen ? (
                  <motion.div
                    key="a"
                    className="faq-a"
                    initial={reduce ? false : { height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={reduce ? undefined : { height: 0, opacity: 0 }}
                    transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <p>{item.a}</p>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MissionStrip() {
  return (
    <section className="mission-strip" aria-labelledby="mission-title">
      <p className="mission-pill">{brand.pill}</p>
      <h2 id="mission-title">{brand.missionHeadline}</h2>
      <ul className="mission-tags">
        {brand.missionTags.map((tag) => (
          <li key={tag}>{tag}</li>
        ))}
      </ul>
      <p>{brand.missionBody}</p>
    </section>
  );
}

function EventPartners() {
  const reduce = useReducedMotion();
  const marks = [...PARTNER_LOGOS, ...PARTNER_LOGOS, ...PARTNER_LOGOS, ...PARTNER_LOGOS];

  return (
    <section className="event-partners" aria-label={brand.partnersHeader}>
      <h2 className="partner-heading">
        <span className="partner-heading-pill">{brand.partnersHeader}</span>
      </h2>
      <div className="partner-marquee-wrap">
        <div className={`partner-marquee${reduce ? " paused" : ""}`}>
          {marks.map((m, idx) => (
            <div className="partner-slot" key={`${m.alt}-${idx}`}>
              <img src={m.src} alt="" />
            </div>
          ))}
        </div>
      </div>
    </section>
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
    <form className="footer-contact" onSubmit={onSubmit}>
      <label className="sr-only" htmlFor="footer-email">
        Email
      </label>
      <div className="footer-contact-row">
        <input
          id="footer-email"
          type="email"
          required
          placeholder="you@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
        <button type="submit" className="footer-contact-go" aria-label="Send contact">
          →
        </button>
      </div>
      <p className="footer-contact-note">Demo contact. No spam.</p>
    </form>
  );
}

export default function Landing() {
  const reduce = useReducedMotion();
  const rise = (delay: number) =>
    reduce
      ? {}
      : {
          initial: { y: 20, opacity: 0 },
          animate: { y: 0, opacity: 1 },
          transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] },
        };

  return (
    <div className="slash-landing slash-entrance landing-atmosphere">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="slash-nav-bar">
        <div className="slash-nav">
          <RelayMark size="nav" />
          <div className="slash-nav-actions">
            <GetStarted />
          </div>
        </div>
      </header>

      <main id="main" className="landing-main">
        <section className="slash-hero">
          <div className="slash-hero-copy">
            <motion.div {...rise(0.12)}>
              <CycleWords />
            </motion.div>
            <motion.p className="slogan" {...rise(0.22)}>
              {brand.slogan}
            </motion.p>
            <motion.div className="cta-row" {...rise(0.32)}>
              <Link to="/app" className="btn btn-primary btn-cta-desk btn-cta-lg">
                {brand.ctaPrimary}
              </Link>
            </motion.div>
          </div>
          <HeroStage />
        </section>

        <MissionStrip />
        <FaqSection />
      </main>

      <EventPartners />

      <footer className="slash-footer landing-footer">
        <div className="footer-left">
          <RelayMark size="sm" href={null} />
          <p>{brand.disclaimer}</p>
        </div>
        <FooterContact />
      </footer>
    </div>
  );
}
