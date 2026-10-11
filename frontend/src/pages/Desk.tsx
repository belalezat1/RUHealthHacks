import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useOperations } from "../operations";
import type { Decision } from "../backendTypes";
import { Avatar, Card, Pill, sentence } from "../components/ui";
import { useRecordedReplay } from "../recordedReplay";
import { RecordedPlayback } from "../components/RecordedPlayback";
const time = (value: string) =>
  new Date(value).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
  });
export default function Desk() {
  const { offers, user, busy: operationBusy, write } = useOperations();
  const {
    report,
    active: replayActive,
    session,
    previous,
  } = useRecordedReplay();
  const busy = operationBusy || replayActive;
  const [hospitalId, setHospitalId] = useState("");
  const [showAllRisks, setShowAllRisks] = useState(false);
  const [decision, setDecision] = useState<Decision | null>(null);
  useEffect(() => {
    if (session && !hospitalId) setHospitalId(session.default_hospital_id);
  }, [session, hospitalId]);
  useEffect(() => {
    if (replayActive) setDecision(null);
  }, [replayActive]);
  const act = (path: string) => void write(path).catch(() => {});
  if (user.role === "physician")
    return (
      <div className="rx-page">
        <Card title="Your shift offers">
          <p>
            Only your offers are shown. Acceptance is a planned commitment;
            observed online presence must still be verified.
          </p>
          {offers.length === 0 && <p>No offers for your account.</p>}
          {offers.map((o) => (
            <article key={o.offer_id} className="real-row">
              <strong>{o.hospital_names.join(", ")}</strong>
              <p>
                {o.start} → {o.end} · {o.hours} hours · {sentence(o.status)}
              </p>
              <p>
                {o.status_reason} · Expires: {o.expires_at ?? "Not sent"}
              </p>
              {o.status === "sent" && (
                <div className="real-actions">
                  <button
                    className="rx-btn rx-btn-primary"
                    disabled={busy}
                    onClick={() => act(`/api/v1/offers/${o.offer_id}/accept`)}
                  >
                    Accept offer
                  </button>
                  <button
                    className="rx-btn rx-btn-secondary"
                    disabled={busy}
                    onClick={() => act(`/api/v1/offers/${o.offer_id}/decline`)}
                  >
                    Decline offer
                  </button>
                </div>
              )}
            </article>
          ))}
        </Card>
      </div>
    );
  if (!report) return <div className="rx-page">Loading official records…</div>;
  const r = report;
  const hospital =
    r.coverage.hospitals.find((h) => h.hospital_id === hospitalId) ??
    r.coverage.hospitals.find(
      (h) => h.hospital_id === r.staffing.target?.hospital_id,
    ) ??
    r.coverage.hospitals[0];
  const prior = previous?.report;
  const changed = (before: unknown, after: unknown) =>
    prior && before !== after ? "ops-data-changed" : "";
  const priorHospital = prior?.coverage.hospitals.find(
    (h) => h.hospital_id === hospital?.hospital_id,
  );
  return (
    <div className="rx-page">
      <section className="ops-intro" aria-label="Operational overview">
        <div>
          <span className="ops-eyebrow">YOUR OPERATIONS, AT A GLANCE</span>
          <h2>Keep the next consult moving.</h2>
          <p>
            Review coverage, verify eligibility, and keep every offer under
            human approval.
          </p>
        </div>
        <Link className="rx-btn rx-btn-primary" to="/app/lab">
          Import real CSV <span aria-hidden>↗</span>
        </Link>
      </section>
      <RecordedPlayback
        hospitalId={hospital?.hospital_id ?? ""}
        onHospitalChange={setHospitalId}
      />
      <div className="ops-metrics" aria-label="Current operational metrics">
        <div
          className={changed(
            prior?.counts.open_consults,
            r.counts.open_consults,
          )}
        >
          <span>Open consults</span>
          <strong>{r.counts.open_consults}</strong>
          <small>
            {r.consults.filter((c) => c.waiting_for_assignment).length} awaiting
            assignment
          </small>
        </div>
        <div
          className={changed(
            prior?.physicians.filter((p) => p.routable).length,
            r.physicians.filter((p) => p.routable).length,
          )}
        >
          <span>Routable physicians</span>
          <strong>
            {r.physicians.filter((p) => p.routable).length}
            <em> / {r.physicians.length}</em>
          </strong>
          <small>Verified availability and credentials</small>
        </div>
        <div
          className={changed(
            prior?.risks.filter((x) => x.severity === "critical").length,
            r.risks.filter((x) => x.severity === "critical").length,
          )}
        >
          <span>Critical risks</span>
          <strong className="ops-critical-number">
            {r.risks.filter((x) => x.severity === "critical").length}
          </strong>
          <small>{r.risks.length} total flagged risks</small>
        </div>
        <div
          className={changed(
            prior?.counts.events_applied,
            r.counts.events_applied,
          )}
        >
          <span>Recorded events</span>
          <strong>{r.counts.events_applied.toLocaleString()}</strong>
          <small className="ops-event-label">
            {r.counts.events_applied} recorded events
          </small>
        </div>
      </div>
      <div className="rx-grid-main">
        <Card
          id="forecast"
          title="Coverage outlook"
          actions={
            <label>
              Hospital{" "}
              <select
                aria-label="Forecast hospital"
                disabled={replayActive}
                value={hospital?.hospital_id ?? ""}
                onChange={(e) => setHospitalId(e.target.value)}
              >
                {r.coverage.hospitals.map((h) => (
                  <option key={h.hospital_id} value={h.hospital_id}>
                    {h.hospital_name}
                  </option>
                ))}
              </select>
            </label>
          }
        >
          <p>
            Modeled forecast from official records, shown per hospital. Shared
            physicians are not summed across hospitals.
          </p>
          {hospital ? (
            <>
              <div className="real-chart">
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  minWidth={0}
                  initialDimension={{ width: 600, height: 256 }}
                >
                  <LineChart
                    data={hospital.samples.map((s) => ({
                      ...s,
                      label: time(s.at),
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    <Line
                      name="Required (modeled)"
                      dataKey="required"
                      isAnimationActive={false}
                      stroke="#d48b21"
                      dot={false}
                    />
                    <Line
                      name="Confirmed available"
                      dataKey="confirmed_available"
                      isAnimationActive={false}
                      stroke="#3a7cce"
                      dot={false}
                    />
                    <Line
                      name="Planned + confirmed"
                      dataKey="available"
                      isAnimationActive={false}
                      stroke="#5c9b71"
                      strokeDasharray="5 4"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p>
                {hospital.deficit_minutes} projected physician-minutes of
                deficit · Peak deficit {hospital.peak_deficit}
              </p>
              {priorHospital &&
                priorHospital.deficit_minutes !== hospital.deficit_minutes && (
                  <Pill tone="accent">Forecast updated at this time point</Pill>
                )}
            </>
          ) : (
            <p>No coverage projection available.</p>
          )}
        </Card>
        <div className="rx-rail">
          <Card title="Next coverage action" className="ops-next-action">
            <Pill
              tone={
                r.staffing.candidates.some((c) => c.eligible)
                  ? "accent"
                  : "caution"
              }
            >
              {r.staffing.candidates.filter((c) => c.eligible).length} eligible
              backup
              {r.staffing.candidates.filter((c) => c.eligible).length === 1
                ? ""
                : "s"}
            </Pill>
            <h3>
              {r.staffing.target?.hospital_name ?? "No staffing gap identified"}
            </h3>
            <p>
              {r.staffing.message ??
                "Review the verified staffing evidence before proposing a shift offer."}
            </p>
            {user.role === "coordinator" && (
              <button
                className="rx-btn rx-btn-primary ops-full-button"
                disabled={
                  busy || !r.staffing.candidates.some((c) => c.eligible)
                }
                onClick={() =>
                  void write<Decision>("/api/v1/decisions/preview")
                    .then((value) => {
                      setDecision(value);
                      document.getElementById("interventions")?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      });
                    })
                    .catch(() => {})
                }
              >
                {operationBusy ? "Checking…" : "Review decision"}
              </button>
            )}
            {user.role === "clinical_lead" && (
              <a
                className="rx-btn rx-btn-primary ops-full-button"
                href="#offers"
              >
                Review offers for approval
              </a>
            )}
            {!r.staffing.candidates.some((c) => c.eligible) && (
              <p className="ops-helper">
                No candidate currently passes every eligibility rule. Review the
                evidence below.
              </p>
            )}
            <a className="ops-text-link" href="#interventions">
              See staffing & eligibility →
            </a>
          </Card>
          <Card title="Source verification" className="ops-source-card">
            <Pill tone={r.verification.passed ? "ok" : "muted"}>
              {r.verification.applicable
                ? `${r.verification.matched}/${r.verification.compared} snapshot fields match`
                : "Imported records active"}
            </Pill>
            <p>
              {Object.keys(r.evidence.source_hashes).length} source files ·{" "}
              {r.counts.events_not_yet_visible} events not yet visible
            </p>
            <details>
              <summary>Source and financial evidence</summary>
              <p>{r.run.label}</p>
              <Pill>Cost estimates unavailable</Pill>
              <p>{r.evidence.finance.note}</p>
            </details>
          </Card>
        </div>
      </div>
      <Card
        id="queue"
        title="Observed risks & modeled coverage gaps"
        count={r.risks.length}
      >
        {r.risks.length === 0 && <p>No current risks.</p>}
        {(showAllRisks ? r.risks : r.risks.slice(0, 3)).map((risk) => (
          <article
            className={`real-row ${prior && !prior.risks.some((p) => p.id === risk.id && p.severity === risk.severity && p.summary === risk.summary) ? "ops-row-changed" : ""}`}
            key={risk.id}
          >
            <Pill
              tone={
                risk.severity === "critical"
                  ? "critical"
                  : risk.severity === "warning"
                    ? "caution"
                    : "muted"
              }
            >
              {risk.severity}
            </Pill>
            <h3>{risk.title}</h3>
            <p>{risk.summary}</p>
            <details>
              <summary>Evidence and recommended action</summary>
              <p>{risk.detail}</p>
              <p>
                {risk.action.label}: {risk.action.why}
              </p>
            </details>
          </article>
        ))}
        {r.risks.length > 3 && (
          <button
            className="rx-btn rx-btn-secondary ops-full-button"
            aria-expanded={showAllRisks}
            onClick={() => setShowAllRisks(!showAllRisks)}
          >
            {showAllRisks
              ? "Show priority risks"
              : `Show all ${r.risks.length} risks`}
          </button>
        )}
      </Card>
      <Card id="interventions" title="Decide · Server-verified eligibility">
        <p>
          {r.staffing.target
            ? `${r.staffing.target.hospital_name}: ${r.staffing.target.reason}`
            : (r.staffing.message ?? "No staffing target.")}
        </p>
        <p>
          Ranking comes from the backend. Missing labor evidence blocks
          eligibility.
        </p>
        <div className="real-table-wrap">
          <table className="real-table">
            <thead>
              <tr>
                <th>Physician</th>
                <th>Eligibility</th>
                <th>Rank</th>
                <th>Minutes to online</th>
                <th>Rule evidence</th>
              </tr>
            </thead>
            <tbody>
              {r.staffing.candidates.map((c) => (
                <tr key={c.physician_id}>
                  <td>{c.name}</td>
                  <td>
                    {c.eligibility_status ??
                      (c.eligible ? "eligible" : "ineligible")}
                  </td>
                  <td>{c.rank ?? "—"}</td>
                  <td>{c.minutes_to_online}</td>
                  <td>
                    <details>
                      <summary>
                        {c.rules.filter((x) => x.passed).length}/
                        {c.rules.length} rules passed
                      </summary>
                      {c.rules.map((rule) => (
                        <p key={rule.rule}>
                          {rule.passed ? "Pass" : "Fail"} · {rule.label}:{" "}
                          {rule.detail}
                        </p>
                      ))}
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {decision && (
          <div className="real-row">
            <p>
              Decision: {decision.source} · {decision.status} ·{" "}
              {decision.latency_ms} ms
            </p>
            <p>
              Selected:{" "}
              {decision.selected_physician_ids
                .map(
                  (id) =>
                    r.staffing.candidates.find((c) => c.physician_id === id)
                      ?.name ?? id,
                )
                .join(", ") || "No feasible action"}
            </p>
            {decision.fallback_reason && <p>{decision.fallback_reason}</p>}
            <button
              className="rx-btn rx-btn-primary"
              disabled={
                busy ||
                decision.status !== "ready" ||
                user.role !== "coordinator"
              }
              onClick={() =>
                void write("/api/v1/offers/propose", {
                  decision_id: decision.decision_id,
                })
                  .then(() => setDecision(null))
                  .catch(() => setDecision(null))
              }
            >
              Propose offer for approval
            </button>
          </div>
        )}
      </Card>
      <Card id="offers" title="Approval & offer tracking">
        <p>
          Server-enforced roles and expiration. Accepted offers remain planned
          capacity until presence is observed.
        </p>
        {r.offers.length === 0 && <p>No offers proposed yet.</p>}
        {r.offers.map((o) => (
          <article className="real-row" key={o.offer_id}>
            <h3>
              {o.physician_name} · {o.hospital_names.join(", ")}
            </h3>
            <Pill>{sentence(o.status)}</Pill>
            <p>
              {o.window_start} → {o.window_end}
            </p>
            <p>
              {o.status_reason} · Expires: {o.expires_at ?? "Not sent"}
            </p>
            <div className="real-actions">
              {user.role === "clinical_lead" && o.status === "proposed" && (
                <>
                  <button
                    className="rx-btn rx-btn-primary"
                    disabled={busy}
                    onClick={() => act(`/api/v1/offers/${o.offer_id}/approve`)}
                  >
                    Approve offer
                  </button>
                  <button
                    className="rx-btn rx-btn-secondary"
                    disabled={busy}
                    onClick={() => act(`/api/v1/offers/${o.offer_id}/reject`)}
                  >
                    Reject offer
                  </button>
                </>
              )}
              {user.role === "coordinator" && o.status === "approved" && (
                <button
                  className="rx-btn rx-btn-primary"
                  disabled={busy}
                  onClick={() => act(`/api/v1/offers/${o.offer_id}/send`)}
                >
                  Send approved offer
                </button>
              )}
            </div>
          </article>
        ))}
      </Card>
      <div id="people" className="rx-grid-2">
        <Card title="Physicians" count={r.physicians.length}>
          <div className="real-table-wrap">
            <table className="real-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>State</th>
                  <th>Workload</th>
                  <th>Availability & credentials</th>
                </tr>
              </thead>
              <tbody>
                {r.physicians.map((p) => (
                  <tr
                    key={p.physician_id}
                    className={
                      prior &&
                      !prior.physicians.some(
                        (old) =>
                          old.physician_id === p.physician_id &&
                          old.derived_state === p.derived_state &&
                          old.calls_this_shift === p.calls_this_shift &&
                          old.open_consults === p.open_consults &&
                          old.routable === p.routable,
                      )
                        ? "ops-row-changed"
                        : ""
                    }
                  >
                    <td>
                      <Avatar name={p.name} /> {p.name}
                    </td>
                    <td>{sentence(p.derived_state)}</td>
                    <td>
                      {p.open_consults} open · {p.calls_this_shift} calls
                    </td>
                    <td>
                      {p.busy
                        ? "Busy"
                        : p.in_cooldown
                          ? "Cooldown"
                          : p.routable
                            ? "Routable"
                            : "Not routable"}
                      <details>
                        <summary>Evidence</summary>
                        <p>{p.credentials.join(", ")}</p>
                        <p>{p.flags.join("; ")}</p>
                        <p>{p.presence_verification_basis}</p>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Consult queue" count={r.consults.length}>
          <div className="real-table-wrap">
            <table className="real-table">
              <thead>
                <tr>
                  <th>Consult</th>
                  <th>Hospital</th>
                  <th>Stage</th>
                  <th>Minutes</th>
                </tr>
              </thead>
              <tbody>
                {r.consults.map((c) => (
                  <tr
                    key={c.consult_id}
                    className={
                      prior &&
                      !prior.consults.some(
                        (old) =>
                          old.consult_id === c.consult_id &&
                          old.current_stage === c.current_stage &&
                          old.physician_id === c.physician_id &&
                          old.minutes_in_stage === c.minutes_in_stage,
                      )
                        ? "ops-row-changed"
                        : ""
                    }
                  >
                    <td>
                      {c.consult_id}
                      <br />
                      {c.consult_type}
                    </td>
                    <td>{c.hospital_name}</td>
                    <td>{sentence(c.current_stage)}</td>
                    <td>{c.minutes_in_stage ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
