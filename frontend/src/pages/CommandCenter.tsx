import { Link } from "react-router-dom";
import type { Dashboard } from "../api/types";
import { ForecastChart, ChartLegend } from "../components/ForecastChart";
import { OperationalGate } from "../components/OperationalGate";
import {
  Badge,
  Empty,
  Icon,
  PageHeading,
  Panel,
  Stat,
  human,
  time,
  tone,
} from "../components/ui";
export default function CommandCenter() {
  return (
    <>
      <PageHeading
        title="Command Center"
        description="A clear view of your network. Every decision grounded in evidence."
        action={
          <Link to="/simulation" className="button">
            <Icon name="flask" size={17} />
            Scenario controls
          </Link>
        }
      />
      <OperationalGate>{(data) => <Overview data={data} />}</OperationalGate>
    </>
  );
}
function Overview({ data }: { data: Dashboard }) {
  const risks = data.forecast.risks;
  const waiting = data.consultations.filter((c) => c.status === "waiting");
  const available = data.physicians.filter(
    (p) => p.availability.status === "available",
  ).length;
  return (
    <>
      <div className="stats-grid">
        <Stat
          label="Physicians in network"
          value={data.counts.physicians}
          detail={`${available} currently available`}
          icon="people"
        />
        <Stat
          label="Consultations waiting"
          value={data.counts.waiting}
          detail={`${waiting.filter((c) => c.priority === "urgent").length} with source urgency: urgent`}
          icon="queue"
          alert={waiting.some((c) => c.priority === "urgent")}
        />
        <Stat
          label="Hospitals at risk"
          value={data.counts.at_risk_hospitals}
          detail="Within the next 90 minutes"
          icon="chart"
          alert={data.counts.at_risk_hospitals > 0}
        />
        <Stat
          label="Pending interventions"
          value={data.counts.pending_interventions}
          detail="Human review required"
          icon="shield"
        />
      </div>
      <div className="overview-grid">
        <Panel
          title="Coverage outlook"
          subtitle="Projected demand and allocated capacity · next 90 minutes"
          action={
            <Link className="text-link" to="/coverage">
              Explore forecast <Icon name="arrow" size={15} />
            </Link>
          }
        >
          <ChartLegend />
          <ForecastChart forecast={data.forecast} />
          <div className="panel-foot">
            <Icon name="clock" size={14} /> As of {time(data.as_of)} · Six
            15-minute intervals · Demo policy
          </div>
        </Panel>
        <Panel
          title="Attention needed"
          subtitle="Prioritized by operational risk"
          className="attention-panel"
          action={
            <Badge tone={risks.length ? "amber" : "green"}>
              {risks.length} risks
            </Badge>
          }
        >
          {risks.length ? (
            <div className="risk-list">
              {risks.slice(0, 3).map((risk, i) => (
                <Link
                  to={`/coverage?hospital=${encodeURIComponent(risk.hospital_id)}`}
                  className="risk-item"
                  key={`${risk.hospital_id}-${i}`}
                >
                  <span
                    className={`risk-symbol ${risk.severity === "critical" || risk.severity === "high" ? "red" : ""}`}
                  >
                    <Icon name="alert" size={18} />
                  </span>
                  <div>
                    <strong>
                      {data.hospitals.find((h) => h.id === risk.hospital_id)
                        ?.name ?? risk.hospital_id}
                    </strong>
                    <p>
                      {risk.reason ??
                        risk.explanation ??
                        "Projected qualified capacity shortfall"}
                    </p>
                    <small>
                      {time(risk.start_at)}
                      {risk.unmet_minutes != null
                        ? ` · ${Number(risk.unmet_minutes).toFixed(0)} unmet min`
                        : ""}
                    </small>
                  </div>
                  <Icon name="arrow" size={15} />
                </Link>
              ))}
            </div>
          ) : (
            <Empty title="No projected gaps">
              No coverage risks identified in the current forecast.
            </Empty>
          )}
          <Link className="panel-foot foot-link" to="/interventions">
            Review intervention workspace
            <Icon name="arrow" size={16} />
          </Link>
        </Panel>
      </div>
      <div className="overview-grid">
        <Panel
          title="Consultation queue"
          subtitle="Source priority and current assignment status"
          action={
            <Link className="text-link" to="/consultations">
              View queue <Icon name="arrow" size={15} />
            </Link>
          }
        >
          {waiting.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Consultation</th>
                    <th>Hospital</th>
                    <th>Priority</th>
                    <th>Due</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {waiting.slice(0, 5).map((c) => (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.id}</strong>
                        <small>{human(c.specialty)}</small>
                      </td>
                      <td>
                        {data.hospitals.find((h) => h.id === c.hospital_id)
                          ?.name ?? c.hospital_id}
                      </td>
                      <td>
                        <Badge tone={tone(c.priority)} dot>
                          {c.priority}
                        </Badge>
                      </td>
                      <td className="mono">{time(c.deadline_at)}</td>
                      <td>
                        <Link
                          className="icon-button"
                          aria-label={`Review ${c.id}`}
                          to={`/interventions?consultation=${encodeURIComponent(c.id)}`}
                        >
                          <Icon name="arrow" size={17} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="Queue is clear">
              There are no waiting consultations in this dataset.
            </Empty>
          )}
        </Panel>
        <Panel
          title="Network availability"
          subtitle="Reconciled signals, current workload, and shifts"
          action={
            <Link className="text-link" to="/physicians">
              Directory <Icon name="arrow" size={15} />
            </Link>
          }
        >
          <div className="physician-list">
            {data.physicians.slice(0, 4).map((p) => (
              <Link
                to={`/physicians?physician=${encodeURIComponent(p.id)}`}
                key={p.id}
                className="physician-item"
              >
                <span className="avatar">
                  {p.name
                    .replace(/^Dr\.\s*/, "")
                    .split(" ")
                    .slice(0, 2)
                    .map((n) => n[0])
                    .join("")}
                </span>
                <div>
                  <strong>{p.name}</strong>
                  <small>
                    {p.specialties.map(human).join(" · ")} ·{" "}
                    {p.availability.on_shift ? "On shift" : "Off shift"}
                  </small>
                </div>
                <Badge tone={tone(p.availability.status)} dot>
                  {human(p.availability.status)}
                </Badge>
              </Link>
            ))}
          </div>
        </Panel>
      </div>
      <div className="guidance-strip">
        <Icon name="shield" />
        <div>
          <strong>Human decisions. Transparent evidence.</strong>
          <span>
            Projections support operational review. Approval, physician consent,
            and activation evidence are separate steps.
          </span>
        </div>
        <Badge tone={data.jev.mode === "live" ? "green" : "gray"}>
          Jev {data.jev.mode}
        </Badge>
      </div>
    </>
  );
}
