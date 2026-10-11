import { Link } from "react-router-dom";
import type { ImportSummary, Report } from "../backendTypes";
import { Card, Pill, sentence } from "./ui";

export interface ImportOutcome {
  filename: string;
  summary: ImportSummary;
  before: Report;
  after: Report;
}

/** Compare observed server state; never estimate outcomes or create events. */
export function ImportResults({ outcome }: { outcome: ImportOutcome }) {
  const { filename, summary, before, after } = outcome;
  const physicianName = (id: string) =>
    after.physicians.find((p) => p.physician_id === id)?.name ?? id;
  const consults = after.consults.flatMap((current) => {
    const previous = before.consults.find(
      (c) => c.consult_id === current.consult_id,
    );
    const changed =
      !previous ||
      previous.current_stage !== current.current_stage ||
      previous.physician_id !== current.physician_id ||
      previous.routing_failures !== current.routing_failures ||
      previous.waiting_for_assignment !== current.waiting_for_assignment;
    return changed ? [{ current, previous }] : [];
  });
  const physicians = after.physicians.flatMap((current) => {
    const previous = before.physicians.find(
      (p) => p.physician_id === current.physician_id,
    );
    const changed =
      !previous ||
      previous.derived_state !== current.derived_state ||
      previous.busy !== current.busy ||
      previous.routable !== current.routable ||
      previous.flags.join("|") !== current.flags.join("|");
    return changed ? [{ current, previous }] : [];
  });
  const selected = after.staffing.selected.map(physicianName);
  const clock = (instant: string) =>
    new Date(instant).toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  return (
    <Card
      title="CSV import results"
      id="import-results"
      actions={
        <Link className="rx-btn rx-btn-secondary" to="/app">
          View coverage desk
        </Link>
      }
    >
      <p>
        <strong>{filename}</strong> · Actual server state before and after
        replay
      </p>
      <div className="real-actions">
        <Pill tone="ok">{summary.accepted ?? 0} events imported</Pill>
        <Pill>{summary.duplicates ?? 0} duplicates skipped</Pill>
        <Pill>{summary.error_count ?? 0} errors</Pill>
      </div>
      <div className="real-result-metrics">
        <div>
          <span>Recorded events</span>
          <strong>
            {before.counts.events_applied.toLocaleString()} →{" "}
            {after.counts.events_applied.toLocaleString()}
          </strong>
        </div>
        <div>
          <span>Open consults</span>
          <strong>
            {before.counts.open_consults} → {after.counts.open_consults}
          </strong>
        </div>
        <div>
          <span>Scenario time · ET</span>
          <strong>
            {clock(before.as_of)} → {clock(after.as_of)}
          </strong>
        </div>
      </div>
      <p>
        Changes below include imported records and any scenario clock
        advancement. They describe operational state, without claiming clinical
        improvement.
      </p>
      <h3>Consult results</h3>
      {consults.length === 0 ? (
        <p>No consult status or assignment changes.</p>
      ) : (
        <div className="real-table-wrap">
          <table className="real-table">
            <thead>
              <tr>
                <th>Consult / hospital</th>
                <th>Before</th>
                <th>After</th>
                <th>Recorded routing failures</th>
              </tr>
            </thead>
            <tbody>
              {consults.map(({ current, previous }) => (
                <tr key={current.consult_id}>
                  <td>
                    {current.consult_id}
                    <br />
                    {current.hospital_name}
                  </td>
                  <td>
                    {previous ? (
                      <>
                        {sentence(previous.current_stage)}
                        <br />
                        {physicianName(previous.physician_id)}
                      </>
                    ) : (
                      "Not yet recorded"
                    )}
                  </td>
                  <td>
                    {sentence(current.current_stage)}
                    <br />
                    {current.waiting_for_assignment
                      ? "Awaiting physician assignment"
                      : physicianName(current.physician_id)}
                  </td>
                  <td>
                    {previous?.routing_failures ?? "—"} →{" "}
                    {current.routing_failures}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3>Physician results</h3>
      {physicians.length === 0 ? (
        <p>No physician availability changes.</p>
      ) : (
        <div className="real-table-wrap">
          <table className="real-table">
            <thead>
              <tr>
                <th>Physician</th>
                <th>Before</th>
                <th>After</th>
                <th>Routing status</th>
              </tr>
            </thead>
            <tbody>
              {physicians.map(({ current, previous }) => (
                <tr key={current.physician_id}>
                  <td>
                    {current.name}
                    <br />
                    {current.physician_id}
                  </td>
                  <td>
                    {previous
                      ? sentence(previous.derived_state)
                      : "Not yet recorded"}
                  </td>
                  <td>
                    {sentence(current.derived_state)}
                    {current.busy ? " · Busy" : ""}
                  </td>
                  <td>
                    {current.routable ? "Routable" : "Not routable"}
                    {current.flags.length > 0 && (
                      <p>{current.flags.join("; ")}</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="real-row">
        <h3>Backend staffing recommendation · Modeled</h3>
        {after.staffing.target ? (
          <>
            <p>
              <strong>{after.staffing.target.hospital_name}</strong> ·{" "}
              {after.staffing.target.deficit_minutes} projected
              physician-minutes of deficit
            </p>
            <p>
              {selected.length
                ? `Recommended eligible physicians: ${selected.join(", ")}`
                : (after.staffing.message ?? "No eligible staffing selection.")}
            </p>
            <p>
              {after.staffing.candidates.filter((c) => c.eligible).length}{" "}
              eligible of {after.staffing.candidates.length} reviewed
              candidates. Rest, weekly hours, credentials, availability, and
              overlap are checked by the backend. Clinical lead approval is
              required before sending an offer.
            </p>
          </>
        ) : (
          <p>{after.staffing.message ?? "No current staffing target."}</p>
        )}
      </div>
    </Card>
  );
}
