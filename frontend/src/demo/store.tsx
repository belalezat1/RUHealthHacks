import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Dashboard, Recommendation } from "../api/types";
import { physicianName } from "../lib/format";
import { buildDemoDashboard, demoRecommendation } from "./snapshot";
import { rankCandidates, usd, type CostedCandidate, type RankBy } from "./economics";

export type OfferStep =
  | "idle"
  | "checking"
  | "ready"
  | "approved"
  | "sent"
  | "accepted"
  | "declined"
  | "filled";

/** A party has said yes: the clinical lead approved, or the physician accepted. */
export type Confirmation = {
  id: string;
  kind: "approved" | "accepted";
  party: string;
  title: string;
  detail: string;
  facts: string[];
};

export type FillResult = {
  physicianId: string;
  minutesClosed: number;
  gapMinutes: number;
};

type DemoContextValue = {
  mode: "demo" | "live";
  setMode: (m: "demo" | "live") => void;
  dashboard: Dashboard;
  recommendation: Recommendation;
  offerStep: OfferStep;
  laborSteps: string[];
  laborIndex: number;
  events: { id: string; at: string; text: string }[];
  injectEvent: (text: string) => void;
  openDecide: () => void;
  runLaborCheck: () => Promise<void>;
  approve: () => void;
  sendOffer: () => void;
  physicianRespond: (accepted: boolean) => void;
  proposeNext: () => void;
  resetFlow: () => void;
  panel: "none" | "decide" | "act";
  setPanel: (p: "none" | "decide" | "act") => void;
  rankBy: RankBy;
  setRankBy: (r: RankBy) => void;
  /** Eligible candidates in offer order (declined ones stay listed, flagged). */
  ranked: CostedCandidate[];
  declinedIds: string[];
  /** The candidate the next offer goes to, or null when the ladder is exhausted. */
  primary: CostedCandidate | null;
  gapMinutes: number;
  lastFill: FillResult | null;
  confirmation: Confirmation | null;
  dismissConfirmation: () => void;
};

const DemoContext = createContext<DemoContextValue | null>(null);

const LABOR = [
  "Checking credentialing matrix…",
  "Measuring rest window at offer start…",
  "Validating trailing 7-day hours…",
  "Guarding against the split-shift trap…",
];

const GAP_RISK_ID = "risk-river-shift-end";

export function DemoProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [dashboard, setDashboard] = useState<Dashboard>(() =>
    buildDemoDashboard(),
  );
  const [recommendation, setRecommendation] =
    useState<Recommendation>(demoRecommendation);
  const [offerStep, setOfferStep] = useState<OfferStep>("idle");
  const [laborIndex, setLaborIndex] = useState(-1);
  const [panel, setPanel] = useState<"none" | "decide" | "act">("none");
  const [rankBy, setRankBy] = useState<RankBy>("cost");
  const [declinedIds, setDeclinedIds] = useState<string[]>([]);
  const [lastFill, setLastFill] = useState<FillResult | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const dismissConfirmation = useCallback(() => setConfirmation(null), []);
  const [events, setEvents] = useState<
    { id: string; at: string; text: string }[]
  >([
    {
      id: "e0",
      at: dashboard.as_of,
      text: "Snapshot rebuilt from event stream · late + duplicate events reconciled",
    },
  ]);

  const ranked = useMemo(
    () =>
      rankCandidates(
        [recommendation.candidate, ...recommendation.alternatives],
        rankBy,
      ),
    [recommendation.candidate, recommendation.alternatives, rankBy],
  );
  const primary =
    ranked.find((c) => !declinedIds.includes(c.candidate.physician_id)) ?? null;
  const gapMinutes = useMemo(() => {
    const risk = buildDemoDashboard().forecast.risks.find((r) => r.id === GAP_RISK_ID);
    return Number(risk?.unmet_minutes ?? 45);
  }, []);

  const log = useCallback((text: string) => {
    setEvents((prev) => [
      { id: crypto.randomUUID(), at: new Date().toISOString(), text },
      ...prev,
    ]);
  }, []);

  const nameOf = useCallback(
    (id: string) => physicianName(id, dashboard.physicians),
    [dashboard.physicians],
  );

  const injectEvent = useCallback((text: string) => {
    const at = new Date().toISOString();
    log(text);
    setDashboard((d) => {
      const next = structuredClone(d);
      const risk = {
        id: `risk-inject-${Date.now()}`,
        hospital_id: "hosp-cedar",
        severity: "high",
        reason: text,
        explanation: "Live-injected event applied without restart.",
        start_at: at,
        unmet_minutes: 20,
      };
      next.forecast.risks = [risk, ...next.forecast.risks];
      next.counts.at_risk_hospitals = Math.min(
        12,
        (next.counts.at_risk_hospitals ?? 0) + 1,
      );
      next.freshness = { stale: next.freshness.stale, conflicts: true };
      return next;
    });
  }, [log]);

  const openDecide = useCallback(() => {
    setPanel("decide");
    setOfferStep((s) => (s === "idle" ? "ready" : s));
  }, []);

  const runLaborCheck = useCallback(async () => {
    setOfferStep("checking");
    setLaborIndex(0);
    for (let i = 0; i < LABOR.length; i++) {
      setLaborIndex(i);
      await new Promise((r) => setTimeout(r, 320));
    }
    setOfferStep("ready");
    setLaborIndex(-1);
  }, []);

  const approve = useCallback(() => {
    if (!primary) return;
    setRecommendation((r) => ({ ...r, status: "approved" }));
    setOfferStep("approved");
    setPanel("act");
    const approvedName = nameOf(primary.candidate.physician_id);
    setConfirmation({
      id: crypto.randomUUID(),
      kind: "approved",
      party: "Clinical lead",
      title: "Offer approved",
      detail: `Split shift for ${approvedName} is cleared to send.`,
      facts: [
        `${usd(primary.cost)} est.`,
        `${Math.min(primary.minutesClosed, gapMinutes)} of ${gapMinutes} min`,
        "Eligibility verified",
      ],
    });
    log(
      `Clinical lead approved split-shift offer for ${nameOf(primary.candidate.physician_id)}` +
        (rankBy === "cost" ? " · lowest-cost eligible candidate" : " · best clinical fit"),
    );
  }, [primary, rankBy, gapMinutes, log, nameOf]);

  const sendOffer = useCallback(() => {
    if (!primary) return;
    setRecommendation((r) => ({ ...r, status: "offered" }));
    setOfferStep("sent");
    log(
      `Offer sent to ${nameOf(primary.candidate.physician_id)} (simulated) · expires in 10 minutes · no patient information included`,
    );
  }, [primary, log, nameOf]);

  const physicianRespond = useCallback((accepted: boolean) => {
    if (!primary) return;
    const id = primary.candidate.physician_id;
    const name = nameOf(id);

    if (!accepted) {
      setRecommendation((r) => ({ ...r, status: "declined" }));
      setOfferStep("declined");
      setDeclinedIds((prev) => [...prev, id]);
      log(`${name} declined · ladder moves to the next eligible candidate`);
      return;
    }

    const closed = Math.min(primary.minutesClosed, gapMinutes);
    const full = closed >= gapMinutes;
    setRecommendation((r) => ({ ...r, status: "accepted" }));
    setOfferStep("accepted");
    setLastFill({ physicianId: id, minutesClosed: closed, gapMinutes });
    setConfirmation({
      id: crypto.randomUUID(),
      kind: "accepted",
      party: name,
      title: full ? "Offer accepted. Gap closed" : "Offer accepted",
      detail: full
        ? `${name} confirmed the Riverfront split shift. Offers stopped.`
        : `${name} confirmed. ${gapMinutes - closed} minutes still need cover.`,
      facts: [
        `${closed} of ${gapMinutes} min covered`,
        `Starts ${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(primary.candidate.start_at))} ET`,
        "Audit logged",
      ],
    });
    setDashboard((d) => {
      const next = structuredClone(d);
      next.forecast.risks = full
        ? next.forecast.risks.filter((r) => r.id !== GAP_RISK_ID)
        : next.forecast.risks.map((r) =>
            r.id === GAP_RISK_ID
              ? {
                  ...r,
                  severity: "medium",
                  unmet_minutes: gapMinutes - closed,
                  reason: `${name} accepted and closes ${closed} of ${gapMinutes} uncovered minutes. ${gapMinutes - closed} minutes still need cover.`,
                }
              : r,
          );
      next.forecast.intervals = next.forecast.intervals.map((bin, i) =>
        i >= 2
          ? {
              ...bin,
              capacity_minutes: Math.max(
                full ? (bin.demand_minutes ?? 0) : 0,
                (bin.capacity_minutes ?? 0) + 15,
              ),
              unmet_minutes: full ? 0 : bin.unmet_minutes,
            }
          : bin,
      );
      if (full) {
        next.counts.at_risk_hospitals = Math.max(
          0,
          (next.counts.at_risk_hospitals ?? 1) - 1,
        );
        next.counts.pending_interventions = 0;
      }
      next.consultations = next.consultations.map((c) =>
        c.id === "c-river-waiting-1"
          ? { ...c, status: "assigned", physician_id: id }
          : c,
      );
      next.physicians = next.physicians.map((p) =>
        p.id === id
          ? {
              ...p,
              availability: {
                ...p.availability,
                on_shift: true,
                workload: 1,
                status: "available",
              },
            }
          : p,
      );
      return next;
    });
    log(
      full
        ? `${name} accepted · projected coverage updated · gap filled. Offers stopped`
        : `${name} accepted · ${closed} of ${gapMinutes} gap minutes closed · ${gapMinutes - closed} still uncovered`,
    );
    setTimeout(() => setOfferStep("filled"), 600);
  }, [primary, gapMinutes, log, nameOf]);

  const proposeNext = useCallback(() => {
    setRecommendation((r) => ({ ...r, status: "proposed" }));
    setOfferStep("ready");
    setPanel("decide");
  }, []);

  const resetFlow = useCallback(() => {
    setDashboard(buildDemoDashboard());
    setRecommendation(demoRecommendation);
    setOfferStep("idle");
    setPanel("none");
    setLaborIndex(-1);
    setDeclinedIds([]);
    setLastFill(null);
    setConfirmation(null);
  }, []);

  const value = useMemo(
    () => ({
      mode,
      setMode,
      dashboard,
      recommendation,
      offerStep,
      laborSteps: LABOR,
      laborIndex,
      events,
      injectEvent,
      openDecide,
      runLaborCheck,
      approve,
      sendOffer,
      physicianRespond,
      proposeNext,
      resetFlow,
      panel,
      setPanel,
      rankBy,
      setRankBy,
      ranked,
      declinedIds,
      primary,
      gapMinutes,
      lastFill,
      confirmation,
      dismissConfirmation,
    }),
    [
      mode,
      dashboard,
      recommendation,
      offerStep,
      laborIndex,
      events,
      injectEvent,
      openDecide,
      runLaborCheck,
      approve,
      sendOffer,
      physicianRespond,
      proposeNext,
      resetFlow,
      panel,
      rankBy,
      ranked,
      declinedIds,
      primary,
      gapMinutes,
      lastFill,
      confirmation,
      dismissConfirmation,
    ],
  );

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error("useDemo requires DemoProvider");
  return ctx;
}
