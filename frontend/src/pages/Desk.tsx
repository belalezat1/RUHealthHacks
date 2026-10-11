import { useEffect } from "react";
import { ForecastCard } from "../components/desk/ForecastCard";
import { OfferDrawer } from "../components/desk/OfferDrawer";
import { PriorityAlert } from "../components/desk/PriorityAlert";
import { InterventionQueue } from "../components/desk/InterventionQueue";
import { IndicatorsCard, ShiftCard } from "../components/desk/RailCards";
import { ConsultQueue, PhysicianTable } from "../components/desk/Tables";
import { IconRoute } from "../components/Icons";
import { OfferEconomics } from "../components/OfferEconomics";
import { Card, Pill } from "../components/ui";
import { useDemo } from "../demo/store";

/**
 * Coverage desk. Reads top to bottom as Detect (alert, forecast), Decide
 * (who can cover, at what cost) and Act (the approval side panel).
 */
export default function Desk() {
  const { openDecide, offerStep, queue } = useDemo();

  useEffect(() => {
    if (sessionStorage.getItem("sevaro-open-decide") === "1") {
      sessionStorage.removeItem("sevaro-open-decide");
      openDecide();
    }
  }, [openDecide]);

  return (
    <div className="rx-page">
      <PriorityAlert />

      {queue.length > 1 ? <InterventionQueue index={0} /> : null}

      <div className="rx-grid-main">
        <ForecastCard />
        <div className="rx-rail">
          <ShiftCard />
          <IndicatorsCard />
        </div>
      </div>

      <div className="rx-grid-2">
        <PhysicianTable />
        <ConsultQueue />
      </div>

      <Card
        id="interventions"
        title="Interventions"
        icon={<IconRoute size={18} />}
        index={6}
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Pill tone="accent">Cheapest eligible first</Pill>
            {offerStep !== "filled" ? (
              <button type="button" className="rx-btn rx-btn-primary rx-btn-sm" onClick={openDecide}>
                Review intervention
                <span className="rx-btn-arrow" aria-hidden>
                  →
                </span>
              </button>
            ) : null}
          </div>
        }
      >
        <OfferEconomics />
      </Card>

      <OfferDrawer />
    </div>
  );
}
