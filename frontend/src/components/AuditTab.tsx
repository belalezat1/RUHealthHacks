import { mutate } from "../api";
import { hhmm, wall } from "../format";
import type { Report, User } from "../types";
import { useAction } from "./useAction";

export default function AuditTab({ r, user, refresh }: { r: Report; user: User; refresh: () => Promise<void> }) {
  const act = useAction(refresh);
  const escalations = r.actions.filter((a) => a.kind === "escalation");
  const reassignments = r.actions.filter((a) => a.kind === "reassignment");
  const ack = (id: string) =>
    act.run(id, () => mutate(`/api/v1/actions/${id}/acknowledge`, { decision: "Acknowledged; escalation authorized" }),
      () => "Escalation acknowledged.");

  return (
    <div className="grid two">
      <div className="stack">
        {act.notice && <div className={`notice ${act.notice.kind}`} role="status">{act.notice.text}</div>}
        <section className="card">
          <div className="card-head"><h2>Escalations (internal only)</h2></div>
          {escalations.length === 0 && <p className="muted small">None. Escalate from a ranked risk on the Desk.</p>}
          {escalations.map((a) => (
            <div key={a.action_id} className="audit-item">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div><b>{a.risk_id}</b> · by {a.created_by} at {hhmm(a.created_at)} ET</div>
                {a.status === "open" && user.role === "clinical_lead"
                  ? <button className="btn small primary" disabled={act.busy !== null} onClick={() => ack(a.action_id)}>Acknowledge</button>
                  : <span className="badge">{a.status}{a.resolved_by ? ` by ${a.resolved_by}` : ""}</span>}
              </div>
              <div className="muted">{a.note}</div>
            </div>
          ))}
        </section>
        <section className="card">
          <div className="card-head"><h2>Modeled reassignments</h2></div>
          {reassignments.length === 0 && <p className="muted small">None recorded.</p>}
          {reassignments.map((a) => (
            <div key={a.action_id} className="audit-item">
              <b>{a.consult_id}</b> → {a.target_physician_id} · by {a.created_by} at {hhmm(a.created_at)} ET
              <div className="muted">Recorded in the operations model; the production router was not changed.</div>
            </div>
          ))}
        </section>
      </div>
      <section className="card">
        <div className="card-head">
          <h2>Audit log</h2>
          <a className="btn small" href="/api/v1/audit.csv" download>Download CSV</a>
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>Most recent 60 entries for this run. Every approval, exclusion and outcome is recorded with the actor from the server session.</p>
        <div className="drawer-list">
          {r.audit_tail.map((a) => (
            <details key={a.seq} className="audit-item">
              <summary>
                <span className="num muted">#{a.seq}</span> <b>{a.kind}</b> {a.entity} · {a.actor} ({a.role}) · scenario {hhmm(a.scenario_time)} · wall {wall(a.wall_time)}
              </summary>
              <pre className="mono" style={{ whiteSpace: "pre-wrap", margin: "6px 0" }}>{JSON.stringify(a.detail, null, 2)}</pre>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
