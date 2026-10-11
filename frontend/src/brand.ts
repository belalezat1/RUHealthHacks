export const brand = {
  name: "Relay",
  nameLower: "relay",
  product: "Coverage desk",
  slogan: "See the gap. Fill it before the consult waits.",
  support:
    "Live coverage risk for tele-neurology: detect, decide, and act with eligibility you can explain.",
  cycle: ["Detect.", "Decide.", "Act."] as const,
  pill: "Sevaro Challenge 2 · Rutgers Health Hack 2026",
  disclaimer:
    "Synthetic demo data. No patient information. Human approval before every offer.",
  heroVideo: "/hero/relay-hero.mp4",
  /** Flip to "classic" to restore NeuralScene without git history */
  heroVisual: "neuro",
  ctaPrimary: "Open coverage desk",
  getStarted: "Get started",
  deskLabel: "Coverage desk",
  labLabel: "Scenario lab",
  capabilityHeadline: "Built for the moment coverage fails",
  capabilityLede:
    "Relay surfaces the gap, explains who can fill it, and waits for your approval before anything is sent.",
  missionHeadline: "Built for tele-neurology",
  missionBody:
    "Stroke-priority consults cannot wait on a silent coverage gap. Relay watches credentialed capacity, explains who can fill the shortfall, and keeps a human in the loop before every offer.",
  missionTags: ["Neurology", "AI ops", "Patient impact"] as const,
  partnersHeader: "Event partners",
  faqTitle: "Frequently asked questions",
  faqTouch: "Eligibility first. Human approval before every offer.",
  reachOutEmail: "relay@rutgershealthhack.dev",
  reachOutLabel: "Reach out",
} as const;

export const FAQ = [
  {
    q: "What is Relay Coverage desk?",
    a: "Relay is an ops command surface for tele-neurology networks. It detects credentialed coverage risk over the next 90 minutes, decides who is eligible for a split-shift offer with pass/fail rules you can explain, and acts only after a human approves, never from a silent score.",
  },
  {
    q: "How could Sevaro and patients benefit?",
    a: "Sevaro teams see stroke-priority consults waiting, Synapse session state, and capacity shortfalls before a gap becomes uncovered minutes. Faster, safer coverage decisions mean neurologists reach the bedside sooner, without exposing patient information in notifications.",
  },
  {
    q: "What gap does Relay fill?",
    a: "Networks often discover shortfalls too late, or push offers without checking rest windows, credentialing, or the split-shift trap. Relay makes eligibility first-class, keeps AI advisory, and stops offers when the gap is filled, matching how clinical ops actually work.",
  },
] as const;

/** Order: Rutgers Health, Sevaro, AWS, Microsoft */
export const PARTNER_LOGOS = [
  { src: "/brand/rutgers-health-hack-dark.svg", alt: "Rutgers Health Hack" },
  { src: "/brand/sevaro.svg", alt: "Sevaro" },
  { src: "/brand/partners/aws.png", alt: "AWS" },
  { src: "/brand/partners/microsoft.png", alt: "Microsoft" },
] as const;
