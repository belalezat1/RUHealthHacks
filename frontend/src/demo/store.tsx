import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Dashboard, Recommendation } from "../api/types";
import { buildDemoDashboard, demoRecommendation } from "./snapshot";

export type OfferStep =
  | "idle"
  | "checking"
  | "ready"
  | "approved"
  | "sent"
  | "accepted"
  | "declined"
  | "filled";

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
  resetFlow: () => void;
  panel: "none" | "decide" | "act";
  setPanel: (p: "none" | "decide" | "act") => void;
};

const DemoContext = createContext<DemoContextValue | null>(null);

const LABOR = [
  "Checking credentialing matrix…",
  "Measuring rest window at offer start…",
  "Validating trailing 7-day hours…",
  "Guarding against the split-shift trap…",
];

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
  const [events, setEvents] = useState<
    { id: string; at: string; text: string }[]
  >([
    {
      id: "e0",
      at: dashboard.as_of,
      text: "Snapshot rebuilt from event stream · late + duplicate events reconciled",
    },
  ]);

  const injectEvent = useCallback((text: string) => {
    const at = new Date().toISOString();
    setEvents((prev) => [
      { id: crypto.randomUUID(), at, text },
      ...prev,
    ]);
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
  }, []);

  const openDecide = useCallback(() => {
    setPanel("decide");
    setOfferStep("ready");
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
    setRecommendation((r) => ({ ...r, status: "approved" }));
    setOfferStep("approved");
    setPanel("act");
    setEvents((prev) => [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        text: "Clinical lead approved split-shift offer for Dr. Morgan Vale",
      },
      ...prev,
    ]);
  }, []);

  const sendOffer = useCallback(() => {
    setRecommendation((r) => ({ ...r, status: "offered" }));
    setOfferStep("sent");
    setEvents((prev) => [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        text: "Offer sent (simulated) · expires in 10 minutes · no patient information included",
      },
      ...prev,
    ]);
  }, []);

  const physicianRespond = useCallback((accepted: boolean) => {
    if (accepted) {
      setRecommendation((r) => ({ ...r, status: "accepted" }));
      setOfferStep("accepted");
      setDashboard((d) => {
        const next = structuredClone(d);
        next.forecast.risks = next.forecast.risks.filter(
          (r) => r.id !== "risk-river-shift-end",
        );
        next.forecast.intervals = next.forecast.intervals.map((bin, i) =>
          i >= 2
            ? {
                ...bin,
                capacity_minutes: Math.max(
                  bin.demand_minutes ?? 0,
                  (bin.capacity_minutes ?? 0) + 15,
                ),
                unmet_minutes: 0,
              }
            : bin,
        );
        next.counts.at_risk_hospitals = Math.max(
          0,
          (next.counts.at_risk_hospitals ?? 1) - 1,
        );
        next.counts.pending_interventions = 0;
        next.consultations = next.consultations.map((c) =>
          c.id === "c-river-waiting-1"
            ? { ...c, status: "assigned", physician_id: "phy-vale" }
            : c,
        );
        next.physicians = next.physicians.map((p) =>
          p.id === "phy-vale"
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
      setEvents((prev) => [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          text: "Physician accepted · projected coverage updated · gap filled — offers stopped",
        },
        ...prev,
      ]);
      setTimeout(() => setOfferStep("filled"), 600);
    } else {
      setRecommendation((r) => ({ ...r, status: "declined" }));
      setOfferStep("declined");
      setEvents((prev) => [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          text: "Physician declined · ranking will propose the next eligible candidate",
        },
        ...prev,
      ]);
    }
  }, []);

  const resetFlow = useCallback(() => {
    setDashboard(buildDemoDashboard());
    setRecommendation(demoRecommendation);
    setOfferStep("idle");
    setPanel("none");
    setLaborIndex(-1);
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
      resetFlow,
      panel,
      setPanel,
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
      resetFlow,
      panel,
    ],
  );

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error("useDemo requires DemoProvider");
  return ctx;
}