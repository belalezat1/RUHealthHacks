import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Dashboard, Recommendation } from "../api/types";
import { physicianName } from "../lib/format";
import { buildDemoDashboard, demoRecommendation } from "./snapshot";
import { rankCandidates, usd, type CostedCandidate, type RankBy } from "./economics";
import { buildRecommendation, byPriority, eligibleOf, type Priority } from "./interventions";

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

/** Offer workflow state for one coverage risk. */
export type Intervention = {
  riskId: string;
  hospitalId: string;
  recommendation: Recommendation;
  offerStep: OfferStep;
  declinedIds: string[];
  selectedId: string | null;
  lastFill: FillResult | null;
  gapMinutes: number;
};

export type Risk = Dashboard["forecast"]["risks"][number];

export type QueueItem = {
  risk: Risk;
  intervention: Intervention | null;
  status: "needs_backup" | "in_progress" | "partial";
};

export type InjectInput = {
  text: string;
  hospitalId: string;
  /** "info" logs the event without raising a coverage risk. */
  priority: Priority | "info";
  unmetMinutes: number;
};

type DemoContextValue = {
  mode: "demo" | "live";
  setMode: (m: "demo" | "live") => void;
  dashboard: Dashboard;
  events: { id: string; at: string; text: string }[];
  /** Raises a risk (unless priority is "info") and returns its id. */
  injectEvent: (input: InjectInput) => string | null;
  resetFlow: () => void;

  /** Open risks in priority order, each with its intervention state. */
  queue: QueueItem[];
  activeRiskId: string | null;
  activeRisk: Risk | null;
  /** Hospital the active intervention is for (stays known after the risk resolves). */
  activeHospitalId: string | null;
  /** Make a risk active and open its Decide panel. */
  openIntervention: (riskId: string) => void;

  // Active intervention: everything below describes `activeRiskId`.
  recommendation: Recommendation;
  offerStep: OfferStep;
  laborSteps: string[];
  laborIndex: number;
  openDecide: () => void;
  runLaborCheck: () => Promise<void>;
  approve: () => void;
  sendOffer: () => void;
  physicianRespond: (accepted: boolean) => void;
  proposeNext: () => void;
  panel: "none" | "decide" | "act";
  setPanel: (p: "none" | "decide" | "act") => void;
  rankBy: RankBy;
  setRankBy: (r: RankBy) => void;
  /** Eligible candidates in offer order (declined ones stay listed, flagged). */
  ranked: CostedCandidate[];
  declinedIds: string[];
  /** The candidate the next offer goes to, or null when the ladder is exhausted. */
  primary: CostedCandidate | null;
  /** Pick which eligible physician receives the offer (before approval). */
  selectCandidate: (physicianId: string) => void;
  /** True while the offer target can still be changed. */
  canSelect: boolean;
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

/** The hand-authored Riverfront gap from the snapshot. */
const SEED_RISK_ID = "risk-river-shift-end";

function seedInterventions(d: Dashboard): Record<string, Intervention> {
  const risk = d.forecast.risks.find((r) => r.id === SEED_RISK_ID);
  return {
    [SEED_RISK_ID]: {
      riskId: SEED_RISK_ID,
      hospitalId: risk?.hospital_id ?? "hosp-river",
      recommendation: demoRecommendation,
      offerStep: "idle",
      declinedIds: [],
      selectedId: null,
      lastFill: null,
      gapMinutes: Number(risk?.unmet_minutes ?? 45),
    },
  };
}

/* Persistence: the demo remembers injected risks and offer progress across reloads. */
const STORAGE_KEY = "relay-demo-state-v1";

type Saved = {
  dashboard: Dashboard;
  interventions: Record<string, Intervention>;
  activeRiskId: string | null;
  commitments: Record<string, string>;
  events: { id: string; at: string; text: string }[];
};

function loadSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Saved;
    if (!saved?.dashboard?.forecast || !saved.interventions) return null;
    // A check interrupted by the reload resumes from "ready".
    for (const i of Object.values(saved.interventions)) {
      if (i.offerStep === "checking") i.offerStep = "ready";
      if (i.offerStep === "accepted") i.offerStep = "filled";
    }
    return saved;
  } catch {
    return null;
  }
}

const EMPTY_REC = { candidate: null, alternatives: [], rejected: [] } as unknown as Recommendation;
const NO_IDS: string[] = [];

export function DemoProvider({ children }: { children: ReactNode }) {
  const [saved] = useState(loadSaved);
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [dashboard, setDashboard] = useState<Dashboard>(() => saved?.dashboard ?? buildDemoDashboard());
  const [interventions, setInterventions] = useState<Record<string, Intervention>>(
    () => saved?.interventions ?? seedInterventions(buildDemoDashboard()),
  );
  const [activeRiskId, setActiveRiskId] = useState<string | null>(saved?.activeRiskId ?? SEED_RISK_ID);
  /** physician id → hospital id they accepted cover for. */
  const [commitments, setCommitments] = useState<Record<string, string>>(saved?.commitments ?? {});
  const [laborIndex, setLaborIndex] = useState(-1);
  const [panel, setPanel] = useState<"none" | "decide" | "act">("none");
  const [rankBy, setRankBy] = useState<RankBy>("cost");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const dismissConfirmation = useCallback(() => setConfirmation(null), []);
  const [events, setEvents] = useState<{ id: string; at: string; text: string }[]>(
    () =>
      saved?.events ?? [
        {
          id: "e0",
          at: buildDemoDashboard().as_of,
          text: "Snapshot rebuilt from event stream · late + duplicate events reconciled",
        },
      ],
  );

  useEffect(() => {
    try {
      const state: Saved = { dashboard, interventions, activeRiskId, commitments, events };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage full or unavailable: the demo still works in memory */
    }
  }, [dashboard, interventions, activeRiskId, commitments, events]);

  const active = activeRiskId ? (interventions[activeRiskId] ?? null) : null;
  const recommendation = active?.recommendation ?? EMPTY_REC;
  const offerStep: OfferStep = active?.offerStep ?? "idle";
  const declinedIds = active?.declinedIds ?? NO_IDS;
  const gapMinutes = active?.gapMinutes ?? 0;
  const lastFill = active?.lastFill ?? null;

  /** Update one intervention immutably. */
  const patch = useCallback((riskId: string, fn: (i: Intervention) => Partial<Intervention>) => {
    setInterventions((all) => (all[riskId] ? { ...all, [riskId]: { ...all[riskId], ...fn(all[riskId]) } } : all));
  }, []);

  const ranked = useMemo(() => rankCandidates(eligibleOf(recommendation), rankBy), [recommendation, rankBy]);
  const selectedId = active?.selectedId ?? null;
  const selected = ranked.find(
    (c) => c.candidate.physician_id === selectedId && !declinedIds.includes(c.candidate.physician_id),
  );
  const primary = selected ?? ranked.find((c) => !declinedIds.includes(c.candidate.physician_id)) ?? null;
  const canSelect = ["idle", "ready", "checking", "declined"].includes(offerStep);

  const queue = useMemo<QueueItem[]>(
    () =>
      [...dashboard.forecast.risks].sort(byPriority).map((risk) => {
        const intervention = (risk.id && interventions[risk.id]) || null;
        const step = intervention?.offerStep ?? "idle";
        const status: QueueItem["status"] = intervention?.lastFill
          ? "partial"
          : step === "idle"
            ? "needs_backup"
            : "in_progress";
        return { risk, intervention, status };
      }),
    [dashboard.forecast.risks, interventions],
  );
  const activeRisk = dashboard.forecast.risks.find((r) => r.id === activeRiskId) ?? null;

  const log = useCallback((text: string) => {
    setEvents((prev) => [{ id: crypto.randomUUID(), at: new Date().toISOString(), text }, ...prev]);
  }, []);

  const nameOf = useCallback((id: string) => physicianName(id, dashboard.physicians), [dashboard.physicians]);
  const hospitalOf = useCallback(
    (id: string) => dashboard.hospitals.find((h) => h.id === id)?.name.split(" ")[0] ?? id,
    [dashboard.hospitals],
  );

  const openIntervention = useCallback(
    (riskId: string) => {
      const risk = dashboard.forecast.risks.find((r) => r.id === riskId);
      if (!risk) return;
      setInterventions((all) => {
        const existing = all[riskId];
        // A partly covered gap starts a fresh round for the remaining minutes.
        const partial = existing?.offerStep === "filled" && existing.lastFill;
        if (existing && existing.offerStep !== "idle" && !partial) return all;
        if (existing && !partial && riskId === SEED_RISK_ID) {
          return { ...all, [riskId]: { ...existing, offerStep: "ready" } };
        }
        // Untouched ladders are rebuilt so they reflect anyone committed since.
        return {
          ...all,
          [riskId]: {
            riskId,
            hospitalId: risk.hospital_id,
            recommendation: buildRecommendation(risk, dashboard, commitments),
            offerStep: "ready",
            declinedIds: [],
            selectedId: null,
            lastFill: null,
            gapMinutes: Number(risk.unmet_minutes ?? 0),
          },
        };
      });
      setActiveRiskId(riskId);
      setPanel("decide");
    },
    [dashboard, commitments],
  );

  const injectEvent = useCallback(
    ({ text, hospitalId, priority, unmetMinutes }: InjectInput): string | null => {
      if (priority === "info") {
        log(`${text} · logged, no new coverage risk`);
        return null;
      }
      const id = `risk-inject-${Date.now()}`;
      const risk = {
        id,
        hospital_id: hospitalId,
        severity: priority,
        reason: text,
        explanation: "Injected from the scenario lab without a restart.",
        start_at: new Date(new Date(dashboard.as_of).getTime() + 10 * 60000).toISOString(),
        unmet_minutes: unmetMinutes,
      } as Risk;
      const next = structuredClone(dashboard);
      next.forecast.risks = [risk, ...next.forecast.risks];
      next.counts.at_risk_hospitals = new Set(next.forecast.risks.map((r) => r.hospital_id)).size;
      next.counts.pending_interventions = (next.counts.pending_interventions ?? 0) + 1;
      setDashboard(next);
      setInterventions((all) => ({
        ...all,
        [id]: {
          riskId: id,
          hospitalId,
          recommendation: buildRecommendation(risk, next, commitments),
          offerStep: "idle",
          declinedIds: [],
          selectedId: null,
          lastFill: null,
          gapMinutes: unmetMinutes,
        },
      }));
      log(`${text} · ${priority} risk at ${hospitalOf(hospitalId)} queued for intervention`);
      return id;
    },
    [dashboard, commitments, log, hospitalOf],
  );

  const openDecide = useCallback(() => {
    // A finished intervention hands over to the highest-priority open risk.
    const activeOpen =
      active && active.offerStep !== "filled" && dashboard.forecast.risks.some((r) => r.id === active.riskId);
    const target = activeOpen ? active.riskId : queue[0]?.risk.id;
    if (target) openIntervention(String(target));
  }, [active, dashboard.forecast.risks, queue, openIntervention]);

  const runLaborCheck = useCallback(async () => {
    if (!activeRiskId) return;
    const riskId = activeRiskId;
    patch(riskId, () => ({ offerStep: "checking" }));
    setLaborIndex(0);
    for (let i = 0; i < LABOR.length; i++) {
      setLaborIndex(i);
      await new Promise((r) => setTimeout(r, 320));
    }
    patch(riskId, () => ({ offerStep: "ready" }));
    setLaborIndex(-1);
  }, [activeRiskId, patch]);

  const selectCandidate = useCallback(
    (physicianId: string) => {
      if (!activeRiskId || !canSelect || declinedIds.includes(physicianId)) return;
      patch(activeRiskId, (i) => ({
        selectedId: physicianId,
        offerStep: i.offerStep === "declined" ? "ready" : i.offerStep,
      }));
    },
    [activeRiskId, canSelect, declinedIds, patch],
  );

  const approve = useCallback(() => {
    if (!primary || !active) return;
    const name = nameOf(primary.candidate.physician_id);
    const where = hospitalOf(active.hospitalId);
    patch(active.riskId, (i) => ({
      offerStep: "approved",
      recommendation: { ...i.recommendation, status: "approved" },
    }));
    setPanel("act");
    setConfirmation({
      id: crypto.randomUUID(),
      kind: "approved",
      party: "Clinical lead",
      title: "Offer approved",
      detail: `Split shift for ${name} at ${where} is cleared to send.`,
      facts: [
        `${usd(primary.cost)} est.`,
        `${Math.min(primary.minutesClosed, gapMinutes)} of ${gapMinutes} min`,
        "Eligibility verified",
      ],
    });
    log(
      `Clinical lead approved split-shift offer for ${name} at ${where}` +
        (rankBy === "cost" ? " · lowest-cost order" : " · best clinical fit order"),
    );
  }, [primary, active, rankBy, gapMinutes, log, nameOf, hospitalOf, patch]);

  const sendOffer = useCallback(() => {
    if (!primary || !active) return;
    patch(active.riskId, (i) => ({
      offerStep: "sent",
      recommendation: { ...i.recommendation, status: "offered" },
    }));
    log(
      `Offer sent to ${nameOf(primary.candidate.physician_id)} (simulated) · expires in 10 minutes · no patient information included`,
    );
  }, [primary, active, log, nameOf, patch]);

  const physicianRespond = useCallback(
    (accepted: boolean) => {
      if (!primary || !active) return;
      const riskId = active.riskId;
      const id = primary.candidate.physician_id;
      const name = nameOf(id);
      const where = hospitalOf(active.hospitalId);

      if (!accepted) {
        patch(riskId, (i) => ({
          offerStep: "declined",
          declinedIds: [...i.declinedIds, id],
          selectedId: null,
          recommendation: { ...i.recommendation, status: "declined" },
        }));
        log(`${name} declined the ${where} offer · ladder moves to the next eligible candidate`);
        return;
      }

      const closed = Math.min(primary.minutesClosed, gapMinutes);
      const full = closed >= gapMinutes;
      patch(riskId, (i) => ({
        offerStep: "accepted",
        lastFill: { physicianId: id, minutesClosed: closed, gapMinutes },
        recommendation: { ...i.recommendation, status: "accepted" },
      }));
      setCommitments((c) => ({ ...c, [id]: active.hospitalId }));
      setConfirmation({
        id: crypto.randomUUID(),
        kind: "accepted",
        party: name,
        title: full ? "Offer accepted. Gap closed" : "Offer accepted",
        detail: full
          ? `${name} confirmed the ${where} split shift. Offers stopped.`
          : `${name} confirmed. ${gapMinutes - closed} minutes at ${where} still need cover.`,
        facts: [
          `${closed} of ${gapMinutes} min covered`,
          `Starts ${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(primary.candidate.start_at))} ET`,
          "Audit logged",
        ],
      });
      setDashboard((d) => {
        const next = structuredClone(d);
        next.forecast.risks = full
          ? next.forecast.risks.filter((r) => r.id !== riskId)
          : next.forecast.risks.map((r) =>
              r.id === riskId
                ? {
                    ...r,
                    severity: "medium",
                    unmet_minutes: gapMinutes - closed,
                    reason: `${name} accepted and closes ${closed} of ${gapMinutes} uncovered minutes. ${gapMinutes - closed} minutes still need cover.`,
                  }
                : r,
            );
        if (riskId === SEED_RISK_ID) {
          // The seeded gap drives the 90-minute forecast and the waiting consult.
          next.forecast.intervals = next.forecast.intervals.map((bin, i) =>
            i >= 2
              ? {
                  ...bin,
                  capacity_minutes: Math.max(full ? (bin.demand_minutes ?? 0) : 0, (bin.capacity_minutes ?? 0) + 15),
                  unmet_minutes: full ? 0 : bin.unmet_minutes,
                }
              : bin,
          );
          next.consultations = next.consultations.map((c) =>
            c.id === "c-river-waiting-1" ? { ...c, status: "assigned", physician_id: id } : c,
          );
        }
        if (full) {
          next.counts.at_risk_hospitals = new Set(next.forecast.risks.map((r) => r.hospital_id)).size;
          next.counts.pending_interventions = Math.max(0, (next.counts.pending_interventions ?? 1) - 1);
        }
        next.physicians = next.physicians.map((p) =>
          p.id === id
            ? { ...p, availability: { ...p.availability, on_shift: true, workload: 1, status: "available" } }
            : p,
        );
        return next;
      });
      log(
        full
          ? `${name} accepted · ${where} gap filled · offers stopped`
          : `${name} accepted · ${closed} of ${gapMinutes} ${where} gap minutes closed · ${gapMinutes - closed} still uncovered`,
      );
      setTimeout(() => patch(riskId, () => ({ offerStep: "filled" })), 600);
    },
    [primary, active, gapMinutes, log, nameOf, hospitalOf, patch],
  );

  const proposeNext = useCallback(() => {
    if (!activeRiskId) return;
    patch(activeRiskId, (i) => ({
      offerStep: "ready",
      recommendation: { ...i.recommendation, status: "proposed" },
    }));
    setPanel("decide");
  }, [activeRiskId, patch]);

  const resetFlow = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    const d = buildDemoDashboard();
    setDashboard(d);
    setInterventions(seedInterventions(d));
    setActiveRiskId(SEED_RISK_ID);
    setCommitments({});
    setPanel("none");
    setLaborIndex(-1);
    setConfirmation(null);
    setEvents([
      {
        id: crypto.randomUUID(),
        at: d.as_of,
        text: "Demo snapshot reset · injected risks and offers cleared",
      },
    ]);
  }, []);

  const activeHospitalId = active?.hospitalId ?? null;

  const value = useMemo(
    () => ({
      mode,
      setMode,
      dashboard,
      events,
      injectEvent,
      resetFlow,
      queue,
      activeRiskId,
      activeRisk,
      activeHospitalId,
      openIntervention,
      recommendation,
      offerStep,
      laborSteps: LABOR,
      laborIndex,
      openDecide,
      runLaborCheck,
      approve,
      sendOffer,
      physicianRespond,
      proposeNext,
      panel,
      setPanel,
      rankBy,
      setRankBy,
      ranked,
      declinedIds,
      primary,
      selectCandidate,
      canSelect,
      gapMinutes,
      lastFill,
      confirmation,
      dismissConfirmation,
    }),
    [
      mode,
      dashboard,
      events,
      injectEvent,
      resetFlow,
      queue,
      activeRiskId,
      activeRisk,
      activeHospitalId,
      openIntervention,
      recommendation,
      offerStep,
      laborIndex,
      openDecide,
      runLaborCheck,
      approve,
      sendOffer,
      physicianRespond,
      proposeNext,
      panel,
      rankBy,
      ranked,
      declinedIds,
      primary,
      selectCandidate,
      canSelect,
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
