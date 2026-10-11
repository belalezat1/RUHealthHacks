import type { OfferStep } from "../demo/store";
import type { FlowStage } from "../components/ui";

/** Where the gap sits in Detect → Decide → Act for a given offer step. */
export function flowStage(step: OfferStep, hasRisk: boolean): FlowStage {
  if (step === "filled") return 3;
  if (!hasRisk) return 0;
  if (step === "approved" || step === "sent" || step === "accepted" || step === "declined") return 2;
  return 1;
}
