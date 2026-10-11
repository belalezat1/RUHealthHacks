import { Link } from "react-router-dom";
import { useOperations } from "../operations";
import { useRecordedReplay } from "../recordedReplay";
import { Card, Pill, sentence } from "./ui";
const clock = (at: string) =>
  new Date(at).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
export function RecordedPlayback({
  hospitalId,
  onHospitalChange,
}: {
  hospitalId: string;
  onHospitalChange: (id: string) => void;
}) {
  const playback = useRecordedReplay();
  const { report: current, busy } = useOperations();
  const { session, frame, previous, playing, loading, active, stale } =
    playback;
  const receipt = current?.imports.at(-1);
  const routed = frame?.routing[hospitalId];
  const priorRouting = previous?.routing[hospitalId];
  const decision = frame?.decision;
  const changedRouting =
    !!previous &&
    priorRouting?.selected?.physician_id !== routed?.selected?.physician_id;
  const changedBackup =
    !!previous &&
    previous.decision.selected_physician_ids.join(",") !==
      decision?.selected_physician_ids.join(",");
  const end = !!session && frame?.index === session.timeline.length - 1;
  return (
    <>
      <Card
        title="Play imported data"
        id="recorded-playback"
        actions={
          <Pill tone={active ? "accent" : "muted"}>
            {active
              ? "Recorded replay · Preview only"
              : "Current operational state"}
          </Pill>
        }
      >
        <div className="ops-playback-top">
          <div>
            <strong>
              {session?.filename ?? receipt?.filename ?? "No CSV imported yet"}
            </strong>
            <p>
              {session
                ? `${session.timeline.length} unique time points · ${session.summary.duplicates ?? 0} duplicates skipped`
                : "Press Play to watch the latest imported records update coverage and physician selections."}
            </p>
          </div>
          {frame && (
            <strong className="ops-playback-time">
              {clock(frame.as_of)} ET
            </strong>
          )}
        </div>
        <p className="ops-helper">
          Recorded events only. Timeline follows ingestion time; late records
          affect decisions when they arrive. Manual offers are excluded from
          this preview.
        </p>
        <label className="ops-routing-hospital">
          Routing hospital{" "}
          <select
            aria-label="Playback routing hospital"
            value={hospitalId}
            disabled={active || busy}
            onChange={(e) => onHospitalChange(e.target.value)}
          >
            {current?.coverage.hospitals.map((h) => (
              <option value={h.hospital_id} key={h.hospital_id}>
                {h.hospital_name}
              </option>
            ))}
          </select>
        </label>
        <div className="real-actions">
          <button
            className="rx-btn rx-btn-primary"
            disabled={busy || stale || (!playing && loading) || !receipt}
            onClick={playing ? playback.pause : playback.play}
          >
            {playing
              ? "Pause"
              : loading
                ? "Loading replay…"
                : end
                  ? "Play again"
                  : "Play"}
          </button>
          <button
            className="rx-btn rx-btn-secondary"
            disabled={!session || loading || stale || playing || end}
            onClick={playback.next}
          >
            Next
          </button>
          <button
            className="rx-btn rx-btn-secondary"
            disabled={!session || stale}
            onClick={playback.restart}
          >
            Restart
          </button>
          {active && (
            <button className="rx-btn rx-btn-secondary" onClick={playback.exit}>
              Return to current state
            </button>
          )}
          {!receipt && (
            <Link className="rx-btn rx-btn-secondary" to="/app/lab">
              Import CSV first
            </Link>
          )}
        </div>
        {session && (
          <div className="ops-playback-progress">
            <progress
              aria-label="Replay progress"
              value={(frame?.index ?? -1) + 1}
              max={session.timeline.length}
            />
            <span>
              {(frame?.index ?? -1) + 1} / {session.timeline.length} time points
              {end
                ? " · Replay complete"
                : loading
                  ? " · Calculating next point…"
                  : playing
                    ? " · Playing"
                    : " · Paused"}
            </span>
          </div>
        )}
        {playback.error && (
          <p className="real-error" role="alert">
            {playback.error}
            {!session && " Try reimporting the CSV in Scenario lab."}
          </p>
        )}
        {frame && (
          <details>
            <summary>
              Events at this time point
              {frame.index < 0 ? " · Before first arrival" : ""}
            </summary>
            {frame.events.length === 0 ? (
              <p>No events from this batch applied yet.</p>
            ) : (
              frame.events.map((event) => (
                <p key={event.event_id}>
                  <strong>{event.event_id}</strong> ·{" "}
                  {sentence(event.event_type)} ·{" "}
                  {event.physician_id || event.consult_id || event.hospital_id}
                  <br />
                  Occurred {clock(event.event_time)} · Arrived{" "}
                  {clock(event.ingested_at)} ET
                </p>
              ))
            )}
          </details>
        )}
      </Card>
      {frame && (
        <div className="rx-grid-2 ops-picks" aria-live="polite">
          <Card
            title="Next consult physician"
            className={changedRouting ? "ops-pick-changed" : ""}
          >
            <Pill tone={changedRouting ? "accent" : "muted"}>
              {previous
                ? changedRouting
                  ? "Selection changed"
                  : "Selection unchanged"
                : "Before first imported event"}
            </Pill>
            <h3>{routed?.selected?.name ?? "No eligible physician"}</h3>
            <p>{routed?.hospital_name} · Deterministic challenge routing</p>
            {routed?.selected && (
              <p>
                {routed.selected.consults_this_shift} recorded consults this
                shift ·{" "}
                {routed.selected.low_volume_priority
                  ? "Low-volume priority"
                  : "Fewest consults priority"}
                <br />
                Last answered:{" "}
                {routed.selected.last_answered_at
                  ? clock(routed.selected.last_answered_at) + " ET"
                  : "No recorded answer"}
                . Ties use least recent answer, then physician ID.
              </p>
            )}
            <details>
              <summary>Credentials, availability, cooldown & workload</summary>
              <div className="real-table-wrap">
                <table className="real-table">
                  <thead>
                    <tr>
                      <th>Physician</th>
                      <th>Routing evidence</th>
                      <th>Workload</th>
                    </tr>
                  </thead>
                  <tbody>
                    {routed?.evidence.map((p) => (
                      <tr key={p.physician_id}>
                        <td>{p.name}</td>
                        <td>
                          {p.eligible
                            ? "Credentialed, on shift, not busy or ringing, outside cooldown"
                            : p.reasons.join("; ")}
                          <br />
                          {p.presence_verified
                            ? "Imported online evidence"
                            : "Presence unverified"}
                          {p.flags.length > 0 && (
                            <>
                              <br />
                              {p.flags.join("; ")}
                            </>
                          )}
                        </td>
                        <td>
                          {p.consults_this_shift} consults · Low-volume
                          threshold {p.low_volume_threshold}
                          <br />
                          Last answered{" "}
                          {p.last_answered_at
                            ? clock(p.last_answered_at)
                            : "Not recorded"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Card>
          <Card
            title="Backup staffing physician"
            className={changedBackup ? "ops-pick-changed" : ""}
          >
            <Pill tone={changedBackup ? "accent" : "muted"}>
              {previous
                ? changedBackup
                  ? "Selection changed"
                  : "Selection unchanged"
                : "Before first imported event"}
            </Pill>
            <h3>
              {decision?.selected_physician_ids
                .map(
                  (pid) =>
                    frame.report.physicians.find((p) => p.physician_id === pid)
                      ?.name ?? pid,
                )
                .join(", ") || "Escalate · No physician selected"}
            </h3>
            <p>
              {frame.report.staffing.target?.hospital_name ?? "No staffing gap"}{" "}
              · Modeled staffing recommendation
            </p>
            <p>
              Source:{" "}
              {decision?.source === "jev"
                ? "Jev"
                : decision?.source === "escalation"
                  ? "Escalation"
                  : "Deterministic fallback"}{" "}
              · {decision?.latency_ms} ms
              {decision?.confidence != null &&
                ` · Confidence ${Math.round(decision.confidence * 100)}%`}
            </p>
            {decision?.fallback_reason && (
              <p>{sentence(decision.fallback_reason)}</p>
            )}
            <p className="ops-helper">
              Only candidates passing backend eligibility rules can be selected.
              Preview does not create or send an offer.
            </p>
          </Card>
        </div>
      )}
    </>
  );
}
