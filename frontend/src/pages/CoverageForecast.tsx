import { useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import type { Dashboard } from "../api/types";
import { OperationalGate } from "../components/OperationalGate";
import { ForecastChart, ChartLegend } from "../components/ForecastChart";
import {
  Badge,
  Empty,
  PageHeading,
  Panel,
  human,
  time,
  tone,
} from "../components/ui";
export default function CoverageForecast() {
  return (
    <>
      <PageHeading
        title="Coverage Forecast"
        description="Qualified capacity across the next 90 minutes, with explicit assumptions."
      />
      <OperationalGate>{(data) => <Coverage data={data} />}</OperationalGate>
    </>
  );
}
function Coverage({ data }: { data: Dashboard }) {
  const [search] = useSearchParams();
  const [hospital, setHospital] = useState(search.get("hospital") ?? "");
  const risks = data.forecast.risks.filter(
    (r) => !hospital || r.hospital_id === hospital,
  );
  return (
    <>
      <div className="toolbar">
        <label>
          Hospital
          <select
            value={hospital}
            onChange={(e) => setHospital(e.target.value)}
          >
            <option value="">All hospitals</option>
            {data.hospitals.map((h) => (
              <option value={h.id} key={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        <span className="muted">
          Snapshot v{data.source_version} · Valid until {time(data.valid_until)}
        </span>
      </div>
      <Panel
        title="Demand and qualified capacity"
        subtitle="Capacity is allocated across the network; a physician is never counted in two places at once."
      >
        <ChartLegend />
        <ForecastChart forecast={data.forecast} hospitalId={hospital} />
      </Panel>
      <Panel
        title="Hospital coverage timeline"
        subtitle="Unmet physician-minutes in each interval; forecasts are operational estimates."
      >
        <div className="table-wrap">
          <table className="timeline-table">
            <thead>
              <tr>
                <th>Hospital / specialty</th>
                {data.forecast.intervals.map((bin) => (
                  <th key={bin.start_at}>
                    {time(bin.start_at)}
                    <small>+15 minutes</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.hospitals
                .filter((h) => !hospital || h.id === hospital)
                .map((h) => (
                  <tr key={h.id}>
                    <td>
                      <strong>{h.name}</strong>
                      <small>
                        {human(h.specialty)} · {h.jurisdiction}
                      </small>
                    </td>
                    {data.forecast.intervals.map((bin) => {
                      const value = bin.hospitals.find(
                        (b) => b.hospital_id === h.id,
                      );
                      return (
                        <td key={bin.start_at}>
                          <div
                            className={`heat-cell ${(value?.unmet_minutes ?? 0) > 0 ? "heat-risk" : "heat-good"}`}
                          >
                            <strong>
                              {value?.unmet_minutes.toFixed(0) ?? "—"} min
                            </strong>
                            <small>
                              {value
                                ? `${value.capacity_minutes.toFixed(0)} / ${value.demand_minutes.toFixed(0)} capacity / demand`
                                : "No estimate"}
                            </small>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="two-columns">
        <Panel
          title="Risk details"
          subtitle={`${risks.length} risks in this view`}
        >
          {risks.length ? (
            <div className="padded-list">
              {risks.map((risk, i) => (
                <div className="detail-card" key={i}>
                  <div className="subheading">
                    <strong>
                      {data.hospitals.find((h) => h.id === risk.hospital_id)
                        ?.name ?? risk.hospital_id}
                    </strong>
                    <Badge tone={tone(risk.severity)}>
                      {human(risk.severity)}
                    </Badge>
                  </div>
                  <p>
                    {risk.reason ??
                      risk.explanation ??
                      "Qualified demand exceeds allocated capacity."}
                  </p>
                  <small>
                    {time(risk.start_at)}–{time(risk.end_at)}
                    {risk.unmet_minutes != null
                      ? ` · ${risk.unmet_minutes} unmet physician-minutes`
                      : ""}
                  </small>
                  <Link to="/interventions" className="text-link">
                    Review feasible interventions →
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="No projected shortfalls">
              Current evidence indicates sufficient capacity for this view.
            </Empty>
          )}
        </Panel>
        <Panel
          title="Forecast assumptions"
          subtitle="Explicit demo policies, not clinical predictions"
        >
          <ul className="assumptions">
            {data.forecast.assumptions.map((a, i) => (
              <li key={i}>{human(a)}</li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
