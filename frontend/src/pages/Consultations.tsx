import { useState } from "react";
import { Link } from "react-router-dom";
import type { Dashboard } from "../api/types";
import { OperationalGate } from "../components/OperationalGate";
import {
  Badge,
  Empty,
  PageHeading,
  Panel,
  human,
  time,
  tone,
} from "../components/ui";
export default function Consultations() {
  return (
    <>
      <PageHeading
        title="Consultation Queue"
        description="Review source urgency, elapsed wait, and the next operational action."
      />
      <OperationalGate>{(data) => <Queue data={data} />}</OperationalGate>
    </>
  );
}
function Queue({ data }: { data: Dashboard }) {
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [hospital, setHospital] = useState("");
  const consults = data.consultations.filter(
    (c) =>
      (!status || c.status === status) &&
      (!priority || c.priority === priority) &&
      (!hospital || c.hospital_id === hospital),
  );
  return (
    <>
      <div className="toolbar">
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {["waiting", "assigned", "active", "completed"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Source priority
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="">All priorities</option>
            <option>urgent</option>
            <option>routine</option>
          </select>
        </label>
        <label>
          Hospital
          <select
            value={hospital}
            onChange={(e) => setHospital(e.target.value)}
          >
            <option value="">All hospitals</option>
            {data.hospitals.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        <span className="muted">{consults.length} consultations</span>
      </div>
      <Panel>
        {consults.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Consultation</th>
                  <th>Hospital</th>
                  <th>Source priority</th>
                  <th>Wait / deadline</th>
                  <th>Status</th>
                  <th>Physician</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {consults.map((c) => {
                  const overdue =
                    c.status === "waiting" &&
                    Date.parse(c.deadline_at) < Date.parse(data.as_of);
                  const wait = Math.max(
                    0,
                    Math.floor(
                      (Date.parse(data.as_of) - Date.parse(c.requested_at)) /
                        60000,
                    ),
                  );
                  return (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.id}</strong>
                        <small>
                          {human(c.specialty)} · {c.duration_minutes} min
                        </small>
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
                      <td>
                        <strong>
                          {c.status === "waiting" ? `${wait} min waiting` : "—"}
                        </strong>
                        <small className={overdue ? "text-danger" : ""}>
                          Due {time(c.deadline_at)}
                          {overdue ? " · overdue" : ""}
                        </small>
                      </td>
                      <td>
                        <Badge tone={tone(c.status)}>{c.status}</Badge>
                        {overdue && (
                          <small className="text-danger">
                            Operational escalation
                          </small>
                        )}
                      </td>
                      <td>
                        {data.physicians.find((p) => p.id === c.physician_id)
                          ?.name ??
                          c.physician_id ?? (
                            <span className="muted">Unassigned</span>
                          )}
                      </td>
                      <td>
                        {c.status === "waiting" ? (
                          <Link
                            className="button small"
                            to={`/interventions?consultation=${encodeURIComponent(c.id)}`}
                          >
                            Find coverage
                          </Link>
                        ) : (
                          <span className="muted">Tracked</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No consultations in this view">
            Try another filter, or inject a consultation in Simulation Lab.
          </Empty>
        )}
      </Panel>
      <p className="page-note">
        Urgency is supplied by the source dataset. The application does not
        infer diagnoses or change clinical priority.
      </p>
    </>
  );
}
