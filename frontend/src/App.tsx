import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, describeError, get, login, logout, mutate, rememberState, setCsrf, validateCsv } from "./api";
import { RelayMark } from "./components/RelayMark";
import { selectSuppliedEvents, suppliedRowCount, type EventPreset } from "./suppliedEvents";
import type { ActionLab, Candidate, Decision, Envelope, ImportSummary, LiveState, Offer, PhysicianOffer, Report, Risk, User } from "./types";

const time = (value: string | null | undefined) => value ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "—";
const number = (value: number | null | undefined) => value == null ? "—" : Math.round(value).toLocaleString();
const readable = (value: string | null | undefined) => value ? value.replaceAll("_", " ").replaceAll("-", " ").replace(/^\w/, c => c.toUpperCase()) : "Not available";
const offerStatus = (status: Offer["status"]) => ({ proposed: "Needs approval", approved: "Approved · ready to send", sent: "Waiting for physician reply", accepted: "Accepted · check online activity", rejected: "Rejected by lead", declined: "Declined by physician", expired: "Reply window expired", cancelled: "Cancelled" })[status];
const physicianName = (report: Report, id: string) => report.physicians.find(p => p.physician_id === id)?.name ?? report.staffing.candidates.find(c => c.physician_id === id)?.name ?? id;
const failedRule = (rule: Candidate["rules"][number]) => ({ opt_in: "Not opted in for extra shifts", credentialed: "Not credentialed at this hospital", rest: "Less than 10 hours of rest, or rest not verified", weekly_hours: "Would exceed 60 hours in seven days", no_schedule_overlap: "Overlaps a scheduled shift", no_accepted_overlap: "Already committed to another shift", one_open_offer: "Another offer is already open", weekly_offer_limit: "Weekly offer limit reached", current_activity: "Currently busy or unavailable", availability_evidence: "Conflicting availability evidence", duration: "Shift is too short", rest_before_next_shift: "Too little rest before the next shift" } as Record<string, string>)[rule.rule] ?? `Does not meet: ${rule.label}`;
type Tab = "desk" | "state" | "offers" | "data" | "audit";

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <main className="login-wrap"><section className="panel login-panel">
    <RelayMark href={null} /><h1>Relay Coverage desk</h1>
    <p>Spot a staffing gap, find eligible backup, and get a clinical lead’s approval before sending an offer.</p>
    <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError("");
      try { const result = await login(username, password); setPassword(""); onLogin(result.user); }
      catch (e) { setError(describeError(e)); } finally { setBusy(false); }
    }}>
      <label>Username<input name="username" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required /></label>
      <label>Password<input name="password" autoComplete="current-password" type="password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
      {error && <p role="alert" className="notice-error">{error}</p>}
      <button className="btn btn-primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
    <p className="muted">Demo roles: coordinator proposes and sends; clinical lead approves; physician accepts or declines. Sign in with your assigned account for each role.</p>
  </section></main>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [state, setState] = useState<LiveState | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [phoneOffers, setPhoneOffers] = useState<PhysicianOffer[]>([]);
  const [tab, setTab] = useState<Tab>("desk");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [lab, setLab] = useState<ActionLab | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState<number | null>(null);
  const [wallNow, setWallNow] = useState(Date.now());
  const loading = useRef(false);
  const identityVersion = useRef(0);

  useEffect(() => {
    let alive = true;
    get<{ user: User; csrf_token: string }>("/api/v1/session").then(result => {
      if (alive) { setCsrf(result.csrf_token); setUser(result.user); }
    }).catch(e => { if (alive && !(e instanceof ApiError && e.status === 401)) setError(describeError(e)); })
      .finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (!user || loading.current) return;
    const version = identityVersion.current;
    loading.current = true;
    try {
      if (user.role === "physician") {
        const envelope = await get<Envelope<{ offers: PhysicianOffer[] }>>("/api/v1/me/offers");
        if (version !== identityVersion.current) return;
        const s = { ...envelope, label: "Supplied challenge records" };
        rememberState(s); setState(s); setPhoneOffers(envelope.data.offers);
      } else {
        const envelope = await get<Envelope<Report>>("/api/v1/report");
        if (version !== identityVersion.current) return;
        const s = { ...envelope, label: envelope.data.run.label };
        rememberState(s); setState(s); setReport(envelope.data);
      }
      setUpdated(Date.now()); setError("");
    } catch (e) {
      if (version !== identityVersion.current) return;
      if (e instanceof ApiError && e.status === 401) { setUser(null); setReport(null); }
      setError(describeError(e));
    } finally { loading.current = false; }
  }, [user]);

  useEffect(() => {
    identityVersion.current += 1;
    setReport(null); setDecision(null); setLab(null); setPhoneOffers([]); setState(null); setUpdated(null);
    void refresh();
    const timer = window.setInterval(() => { setWallNow(Date.now()); void refresh(); }, 2000);
    return () => { window.clearInterval(timer); identityVersion.current += 1; };
  }, [refresh]);

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true); setError(""); setNotice("");
    try { await fn(); setNotice(message); }
    catch (e) { setError(describeError(e)); }
    finally { await refresh(); setBusy(false); }
  };

  if (checking) return <main className="login-wrap"><p role="status">Checking your session…</p></main>;
  if (!user) return <><Login onLogin={setUser} />{error && <p className="connection-alert" role="alert">{error}</p>}</>;
  const stale = updated !== null && wallNow - updated > 10000;
  const decisionStale = !!decision && !!state && (decision.run_id !== state.run_id || decision.revision !== state.revision);

  return <div className="app-shell command-shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <aside className="app-aside"><div className="app-aside-top"><RelayMark />
      <div className="app-workspace"><strong>Relay Coverage desk</strong><span>Organizer / judge records</span></div></div>
      {user.role !== "physician" && <nav className="app-nav" aria-label="Workspace">
        {([["desk", "Coverage desk"], ["state", "Physicians & consults"], ["offers", "Offers"], ["data", "Data & ActionLab"], ["audit", "Audit"]] as [Tab, string][]).map(([key, label]) =>
          <button key={key} className={tab === key ? "nav-active" : ""} aria-current={tab === key ? "page" : undefined} onClick={() => { setTab(key); setNotice(""); }}>{label}</button>)}
      </nav>}
      <div className="app-aside-foot"><strong>{user.display_name}</strong><span>{user.role.replaceAll("_", " ")}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => void act(async () => { await logout(); setUser(null); }, "Signed out.")} disabled={busy}>Sign out</button></div>
    </aside>
    <div className="app-main"><header className="app-topbar"><div><h1>{user.role === "physician" ? "Your shift offers" : "Coverage desk"}</h1><p>Find the gap → choose backup → get approval → send the offer</p></div>
      <div className="clock-label"><strong data-testid="scenario-clock">{time(state?.as_of)} ET</strong><span>Scenario time · revision {state?.revision ?? "—"}</span></div></header>
      <main id="main" className="command-content">
        {error && <div role="alert" className="notice-error">{error}<button className="btn btn-sm" onClick={() => void refresh()}>Refresh</button></div>}
        {stale && <p role="alert" className="notice-error">The connection is stale. Displayed data may be out of date.</p>}
        {notice && <p role="status" className="notice-success">{notice}</p>}
        {updated === null && !error && <p role="status">Loading server state…</p>}
        {user.role === "physician" ? <section className="phone-view" aria-label="Physician phone view"><p>Only your offers are shown. No patient details are included.</p>
          {phoneOffers.length === 0 && updated !== null && <section className="panel"><h2>No shift offers</h2><p>New approved offers will appear here.</p></section>}
          {phoneOffers.map(o => <article className="panel phone-offer" key={o.offer_id}><span className="pill pill-signal">{offerStatus(o.status)}</span><h2>{o.hospital_names.join(", ")}</h2>
            <p>{time(o.start)}–{time(o.end)} ET · {o.hours} offered hours</p><p>Reply by {time(o.expires_at)} ET.</p>
            {o.status === "sent" && <div className="action-row"><button className="btn btn-primary" disabled={busy || stale} onClick={() => void act(() => mutate(`/api/v1/offers/${o.offer_id}/accept`), "Accepted. This is a planned commitment; online capacity awaits imported evidence.")}>Accept offer</button>
              <button className="btn" disabled={busy || stale} onClick={() => void act(() => mutate(`/api/v1/offers/${o.offer_id}/decline`), "Offer declined.")}>Decline offer</button></div>}
            {o.online_at && <p>Planned arrival: {time(o.online_at)} ET. This is not confirmation that you are online.</p>}
          </article>)}</section>
          : report && <>
            {(tab === "desk" || tab === "offers") && <DemoGuide report={report} user={user} decision={decision} onOffers={() => setTab("offers")} />}
            {tab === "desk" && <>
              <div className="stat-grid"><Stat label="Consults still open" value={report.counts.open_consults} /><Stat label="Alerts to review" value={report.risks.length} /><Stat label="Looking ahead" value="90 min" /><Stat label="Backup doctors eligible" value={report.staffing.candidates.filter(c => c.eligible).length} /></div>
              <section className="panel priority-panel"><div className="section-title"><h2>Highest-priority clinical alert</h2><span className="pill pill-critical">{readable(report.risks[0]?.severity ?? "Clear")}</span></div>
                {report.risks[0] ? <RiskItem risk={report.risks[0]} user={user} busy={busy || stale} act={act} /> : <p>No issues detected from the supplied records.</p>}</section>
              <div className="command-grid"><section className="panel"><h2>Where might coverage fall short?</h2><p className="muted">Forecast for the next 90 minutes. One doctor may cover several hospitals; these counts cannot be added together.</p>
                <div className="table-scroll"><table><thead><tr><th>Hospital</th><th>Doctors / needed now</th><th>Confirmed online</th><th>Most extra doctors needed</th><th>Uncovered doctor-minutes</th></tr></thead><tbody>
                  {report.coverage.hospitals.map(h => { const s = h.samples[0]; return <tr key={h.hospital_id}><td><strong>{h.hospital_name}</strong>{h.spike_now && <span className="pill pill-caution">Demand surge</span>}<small>{h.first_gap_at ? `First gap at ${time(h.first_gap_at)} ET` : "No forecast gap"}</small></td>
                    <td>{s.available} / {s.required}<small>{s.planned_ids.length} planned arrivals · {s.unverified_ids.length} not confirmed</small></td><td>{s.confirmed_available ?? s.confirmed_ids?.length ?? "—"}</td><td>{h.peak_deficit}</td><td>{number(h.deficit_minutes)}</td></tr>; })}
                </tbody></table></div><p className="muted">One doctor missing for 30 minutes equals 30 uncovered doctor-minutes. This is a coverage forecast, not a patient wait time.</p><details><summary>Upcoming shift changes</summary>{report.coverage.shift_changes.map((s, i) => <p key={`${s.physician_id}-${i}`}>{time(s.at)} ET · {s.name} · {readable(s.change)}</p>)}</details></section>
                <section className="panel" id="backup-recommendation"><h2>Choose eligible backup</h2><p>{report.staffing.target ? `Review backup for ${report.staffing.target.hospital_name}. The server checks credentials, rest, weekly hours and shift overlap before an offer can be proposed.` : report.staffing.message ?? "No staffing gap detected."}</p>
                  {report.staffing.target && <p><strong>{report.staffing.target.hospital_name}</strong> · {report.staffing.target.deficit_minutes} modeled uncovered doctor-minutes</p>}
                  <button className="btn btn-primary" disabled={busy || stale || !report.staffing.target} onClick={() => void act(async () => {
                    const result = await mutate<Decision>("/api/v1/decisions/preview", {}); setDecision(result.result);
                  }, "Recommendation evaluated. Review the source and evidence before proposing.")}>Review recommendation</button>
                  {decision && <div className="decision-evidence" data-testid="decision"><h3>{decision.source === "jev" ? "Jev selection" : decision.source === "escalation" ? "Escalation required" : "Deterministic fallback"}</h3>
                    <p><strong>{decision.selected_physician_ids.map(id => physicianName(report, id)).join(", ") || "No eligible backup selected"}</strong></p><p>{decision.selected_action ? `Proposed shift: ${time(decision.selected_action.window_start)}–${time(decision.selected_action.window_end)} ET. A clinical lead must approve before this offer is sent.` : "A clinical lead needs to review this situation."}</p>
                    <p className="muted">{decision.source === "jev" ? "Jev chose from the server’s eligible actions." : decision.source === "escalation" ? "No staffing offer was selected; clinical-lead review is needed." : "The rule-based fallback evaluated the eligible actions."} Evaluated in {number(decision.latency_ms)} ms.</p>
                    <details><summary>AI source and technical details</summary><p>{readable(decision.provider.status)} · {decision.model ?? "No provider model"}</p><p>{readable(decision.fallback_reason) }</p></details>
                    {decisionStale && <p role="status">State changed. Review a fresh recommendation before proposing.</p>}
                    {user.role === "coordinator" && <button className="btn" disabled={busy || stale || decisionStale || !decision.selected_action_id} onClick={() => void act(async () => {
                      await mutate("/api/v1/offers/propose", { decision_id: decision.decision_id }); setDecision(null); setTab("offers");
                    }, "Offer proposed. Clinical-lead approval is required before sending.")}>Propose selected offer</button>}
                  </div>}
                  <CandidateList candidates={report.staffing.candidates} />
                </section></div>
              <details className="panel"><summary><strong>All {report.risks.length} clinical alerts, in priority order</strong></summary>{report.risks.map(r => <RiskItem key={r.id} risk={r} user={user} busy={busy || stale} act={act} />)}</details>
            </>}
            {tab === "state" && <>
              <section className="panel"><h2>Physician activity</h2><p>Reported status, derived activity, and evidence are separate.</p><div className="table-scroll"><table><thead><tr><th>Physician</th><th>Activity</th><th>Presence</th><th>Consults / calls</th><th>Shift end</th></tr></thead><tbody>{report.physicians.map(p => <tr key={p.physician_id}><td><strong>{p.name}</strong><small>{p.physician_id}</small></td><td>{readable(p.derived_state)}<small>Reported: {readable(p.self_reported_status)}{p.in_cooldown ? " · cooling down" : ""}</small></td><td>{p.presence_verified ? "Imported participation evidence" : "Unverified"}<small>{readable(p.presence_verification_basis)}</small>{p.planned_capacity && <small>Planned: {time(p.planned_capacity.online_at)}–{time(p.planned_capacity.end)} ET</small>}</td><td>{p.consults_this_shift} / {p.calls_this_shift}</td><td>{p.minutes_to_shift_end == null ? "Off shift" : `${p.minutes_to_shift_end} min`}</td></tr>)}</tbody></table></div></section>
              <section className="panel"><h2>Open consults</h2><div className="table-scroll"><table><thead><tr><th>Consult / hospital</th><th>Type</th><th>Current stage</th><th>Stage time</th><th>Original wait</th></tr></thead><tbody>{report.consults.map(c => <tr key={c.consult_id}><td>{c.consult_id}<small>{c.hospital_name} · {c.physician_id || "Unassigned"}</small></td><td>{c.consult_type}</td><td>{readable(c.current_stage)}<small>{c.routing_failures} failed routing attempts</small></td><td>{number(c.minutes_in_stage)} min</td><td>{number(c.minutes_since_received)} min</td></tr>)}</tbody></table></div></section>
            </>}
            {tab === "offers" && <section className="panel"><h2>Shift offers and next actions</h2><p>The coordinator proposes; the clinical lead approves; the coordinator sends a simulated offer; the named physician replies from their account. Acceptance reserves the shift. Imported activity must confirm the doctor is online.</p>
              {report.offers.length === 0 && <p>No offers. Review a recommendation from the coverage desk.</p>}
              {[...report.offers].reverse().map(o => <OfferCard key={o.offer_id} offer={o} user={user} busy={busy || stale} act={act} />)}
              <h3>Lead escalations</h3>{report.actions.filter(a => a.kind === "escalation").map(a => <article className="history-row" key={a.action_id}><strong>{a.risk_id} · {a.status}</strong><p>{a.note || "Coordinator requested clinical-lead review."}</p>{a.status === "open" && user.role === "clinical_lead" && <button className="btn btn-sm" disabled={busy || stale} onClick={() => void act(() => mutate(`/api/v1/actions/${a.action_id}/acknowledge`, { decision: "Reviewed by clinical lead; external clinical actions require the existing care workflow." }), "Lead review recorded.")}>Acknowledge escalation</button>}</article>)}
              <h3>Accepted gap reservations</h3>{report.gaps.map(g => <p key={g.gap_id}>{g.hospitals.join(", ")} · {g.claims.length}/{g.slots} slots reserved · {g.status}</p>)}
            </section>}
            {tab === "data" && <DataLab report={report} busy={busy || stale} act={act} lab={lab} setLab={setLab} onDesk={() => setTab("desk")} />}
            {tab === "audit" && <section className="panel"><div className="section-title"><h2>Persistent action history</h2><a className="btn btn-sm" href="/api/v1/audit.csv">Export audit CSV</a></div>
              {report.audit_tail.map(a => <article className="history-row" key={a.seq}><strong>{readable(a.kind)}</strong><p>{a.actor} · {readable(a.role)} · {time(a.scenario_time)} ET</p><details><summary>Evidence · revision {a.revision}</summary><pre>{JSON.stringify(a.detail, null, 2)}</pre></details></article>)}
              <h3>Source evidence and limitations</h3><p>{report.evidence.finance.note}</p><ul>{report.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </section>}
            <footer className="evidence-footer">{report.verification.applicable ? `${report.verification.matched}/${report.verification.compared} reference fields matched` : "Reference snapshot applies only to the original supplied state"} · revision {state?.revision} · simulated outreach only</footer>
          </>}
      </main>
    </div>
  </div>;
}

type ActionRunner = (fn: () => Promise<unknown>, message: string) => Promise<void>;
function Stat({ label, value }: { label: string; value: string | number }) { return <section className="panel stat"><span>{label}</span><strong>{value}</strong></section>; }

function DemoGuide({ report, user, decision, onOffers }: { report: Report; user: User; decision: Decision | null; onOffers: () => void }) {
  const offer = [...report.offers].reverse().find(o => ["proposed", "approved", "sent", "accepted"].includes(o.status));
  const freshDecision = decision?.run_id === report.run.run_id && decision?.revision === report.run.revision && !!decision?.selected_action_id;
  const step = offer ? ({ proposed: 2, approved: 3, sent: 4, accepted: 5 } as Record<string, number>)[offer.status] : freshDecision ? 1 : 0;
  const steps = [
    { title: "Find the gap", role: "Coverage desk", detail: "Review the 90-minute forecast." },
    { title: "Choose backup", role: "Coordinator", detail: "Review recommendation, then propose." },
    { title: "Approve", role: "Clinical lead", detail: "Sign in as the lead and open Offers." },
    { title: "Send", role: "Coordinator", detail: "Return as coordinator; send the simulated offer." },
    { title: "Respond", role: "Named physician", detail: "Sign in as the physician; accept or decline." },
  ];
  const instruction = offer?.status === "proposed" ? "Next: the clinical lead signs in, opens Offers, and selects Approve offer."
    : offer?.status === "approved" ? "Next: the coordinator opens Offers and selects Send simulated offer."
    : offer?.status === "sent" ? `Next: ${offer.physician_name} signs in to their physician account and accepts or declines before ${time(offer.expires_at)} ET.`
    : offer?.status === "accepted" ? "Offer accepted. The shift is reserved. Acceptance alone does not confirm the doctor is online; check imported activity before claiming coverage is restored."
    : freshDecision ? "Next: review the selected doctor and choose Propose selected offer. The offer will wait for clinical-lead approval."
    : report.staffing.target ? "Next: choose Review recommendation in the backup card below. The server first excludes doctors who fail the hard rules."
    : "No staffing offer is needed in this state. Review the clinical alerts or import the supplied challenge events.";
  return <section className="panel demo-guide" aria-labelledby="demo-guide-title">
    <div className="section-title"><div><span className="demo-eyebrow">Guided demo · actual challenge records</span><h2 id="demo-guide-title">From a coverage gap to an approved backup shift</h2></div><span className="pill pill-signal">Your role: {readable(user.role)}</span></div>
    <ol className="demo-steps">{steps.map((s, index) => <li key={s.title} className={index === step ? "is-current" : index < step ? "is-complete" : ""} aria-current={index === step ? "step" : undefined}>
      <span className="demo-step-number">{index + 1}</span><div><strong>{s.title}</strong><small>{s.role}</small><p>{s.detail}</p></div>
    </li>)}</ol>
    <div className="demo-next"><p><strong>{instruction}</strong></p>{offer ? <button className="btn btn-sm" onClick={onOffers}>Open offers</button> : report.staffing.target && <a className="btn btn-sm" href="#backup-recommendation">Go to backup recommendation</a>}</div>
    <p className="muted demo-footnote">Use separate assigned accounts for the three roles. Outreach is simulated. Forecast improvements remain modeled until actual online activity is imported.</p>
  </section>;
}

function RiskItem({ risk: r, user, busy, act }: { risk: Risk; user: User; busy: boolean; act: ActionRunner }) {
  const action = async () => {
    if (r.action.action === "reassign" && r.consult_id && r.action.target_physician_id) {
      await mutate("/api/v1/actions/reassign", { consult_id: r.consult_id, physician_id: r.action.target_physician_id });
    } else {
      await mutate("/api/v1/actions/escalate", { risk_id: r.id, consult_id: r.consult_id, kind: r.action.action === "nudge" ? "nudge" : "escalation", target_physician_id: r.action.target_physician_id ?? null });
    }
  };
  return <article className="risk-item"><div className="section-title"><h3>{r.rank}. {r.title}</h3><span className={`pill ${r.severity === "critical" ? "pill-critical" : "pill-caution"}`}>{r.severity}</span></div><p>{r.detail}</p>
    <p className="muted">Suggested: {r.action.label} · {r.action.why} · {r.action.role.replaceAll("_", " ")}</p>
    {r.threshold && <p className="muted">Warning {r.threshold.warning} · critical {r.threshold.critical}{r.kind === "open_notes_near_shift_end" ? " notes" : " min"}</p>}
    {user.role === "coordinator" && ["reassign", "escalate", "nudge"].includes(r.action.action) && <button className="btn btn-sm" disabled={busy} onClick={() => void act(action, "Action recorded in the audit. External clinical workflow is not connected.")}>{r.action.action === "reassign" ? "Record reassignment" : r.action.action === "nudge" ? "Record internal alert" : "Request lead escalation"}</button>}
  </article>;
}

function CandidateList({ candidates }: { candidates: Candidate[] }) {
  return <div className="candidate-list"><h3>Who can cover this shift?</h3><p className="muted">Expand a doctor to see each safety check and the evidence behind it.</p>{candidates.length === 0 && <p>No candidate evaluation is needed for this state.</p>}
    {candidates.map(c => <details key={c.physician_id}><summary><strong>{c.name}</strong><span className={`pill ${c.eligible ? "pill-signal" : "pill-muted"}`}>{c.eligible ? "Eligible" : (c.eligibility_status ?? c.outcome) === "unverified" ? "Evidence missing" : "Cannot offer this shift"}</span><small>{c.eligible ? `Can join in ${c.minutes_to_online} min · ${c.effective_minutes} min of useful coverage` : c.rules.filter(rule => !rule.passed).map(failedRule).join(" · ") || "Required verification incomplete"}</small></summary>
      <ul>{c.rules.map(rule => <li key={rule.rule}><strong>{rule.passed ? "Pass" : "Fail"}</strong> · {rule.label}: {rule.detail}</li>)}</ul>
      {(c.missing_required_evidence ?? c.eligibility?.missing_evidence)?.length ? <p>Missing evidence: {(c.missing_required_evidence ?? c.eligibility?.missing_evidence)?.join(", ")}</p> : null}
    </details>)}
  </div>;
}

function OfferCard({ offer: o, user, busy, act }: { offer: Offer; user: User; busy: boolean; act: ActionRunner }) {
  const transition = (action: string) => void act(() => mutate(`/api/v1/offers/${o.offer_id}/${action}`, action === "reject" || action === "cancel" ? { reason: `Requested by ${user.role}` } : {}), action === "send" ? "Offer sent in the stand-in workflow. No real notification was delivered." : `Offer ${action} recorded.`);
  return <article className="offer-card"><div className="section-title"><h3>{o.physician_name}</h3><span className="pill pill-signal">{offerStatus(o.status)}</span></div><p>{o.hospital_names.join(", ")} · {time(o.window_start)}–{time(o.window_end)} ET</p>
    <p>{o.approved_by ? `Approved by ${o.approved_by}` : "Awaiting lead approval"}{o.expires_at ? ` · reply by ${time(o.expires_at)} ET` : ""}</p>
    {o.online_at && <p>Planned online {time(o.online_at)} ET. Imported evidence is required for confirmed capacity.</p>}
    {o.status === "proposed" && user.role !== "clinical_lead" && <p className="offer-next">Next: sign in with the clinical-lead account to approve or reject this offer.</p>}
    {o.status === "approved" && user.role !== "coordinator" && <p className="offer-next">Next: the coordinator sends the approved offer.</p>}
    {o.status === "sent" && <p className="offer-next">Next: the named physician replies from their own account. The offer expires after 10 scenario minutes.</p>}
    <div className="action-row">{user.role === "clinical_lead" && o.status === "proposed" && <><button className="btn btn-primary" disabled={busy} onClick={() => transition("approve")}>Approve offer</button><button className="btn" disabled={busy} onClick={() => transition("reject")}>Reject offer</button></>}
      {user.role === "coordinator" && o.status === "approved" && <button className="btn btn-primary" disabled={busy} onClick={() => transition("send")}>Send simulated offer</button>}
      {(["proposed", "approved", "sent"].includes(o.status) || (o.status === "accepted" && user.role === "clinical_lead")) && <button className="btn btn-sm" disabled={busy} onClick={() => transition("cancel")}>Cancel offer</button>}</div>
    <details><summary>Decision and eligibility evidence</summary><pre>{JSON.stringify(o.rationale, null, 2)}</pre><CandidateList candidates={o.candidate_audit} /></details>
  </article>;
}

function DataLab({ report, busy, act, lab, setLab, onDesk }: { report: Report; busy: boolean; act: ActionRunner; lab: ActionLab | null; setLab: (value: ActionLab) => void; onDesk: () => void }) {
  const [csv, setCsv] = useState("");
  const [sourceCsv, setSourceCsv] = useState("");
  const [preset, setPreset] = useState<EventPreset>("all");
  const [hospital, setHospital] = useState("");
  const [filename, setFilename] = useState("judge.csv");
  const [validation, setValidation] = useState<ImportSummary | null>(null);
  const [injected, setInjected] = useState(false);
  const select = (kind: EventPreset, scope: string) => { setPreset(kind); setHospital(scope); setCsv(selectSuppliedEvents(sourceCsv, kind, scope)); setValidation(null); setInjected(false); };
  const load = (text: string) => { setSourceCsv(text); setCsv(text); setPreset("all"); setHospital(""); setValidation(null); setInjected(false); };
  return <div className="command-grid"><section className="panel"><h2>Inject supplied events</h2><p>1. Load the judge’s event file. 2. Choose records to replay. 3. Validate, then inject. The backend recalculates alerts and coverage without a restart.</p>
    <label>Event CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={async e => { const file = e.target.files?.[0]; if (file) { load(await file.text()); setFilename(file.name); } }} /></label>
    <details><summary>Or paste the supplied event CSV</summary><label>Supplied CSV text<textarea rows={6} value={sourceCsv} disabled={busy} onChange={e => { load(e.target.value); setFilename("pasted-supplied-events.csv"); }} placeholder="Paste the eight-column header and supplied event rows" /></label></details>
    <div className="injection-presets" role="group" aria-label="Event injection presets">
      {([{ kind: "all", title: "Replay file", detail: "All supplied rows · safe duplicate handling" }, { kind: "outage", title: "Availability outage", detail: "Recorded offline or unavailable signals" }, { kind: "arrivals", title: "Consult arrivals", detail: "Recorded receipts · demand is computed" }, { kind: "late", title: "Late signal", detail: "Recorded signals received after event time" }] as const).map(p => <button type="button" className={`injection-preset ${preset === p.kind ? "is-selected" : ""}`} key={p.kind} disabled={busy || !sourceCsv} aria-pressed={preset === p.kind} onClick={() => select(p.kind, hospital)}><strong>{p.title}</strong><small>{p.detail}</small></button>)}
    </div>
    <label>Hospital scope<select value={hospital} disabled={busy || !sourceCsv} onChange={e => select(preset, e.target.value)}><option value="">All hospitals and network-wide signals</option>{report.coverage.hospitals.map(h => <option key={h.hospital_id} value={h.hospital_id}>{h.hospital_name}</option>)}</select></label>
    {sourceCsv && <p role="status">{filename} · {suppliedRowCount(csv)} of {suppliedRowCount(sourceCsv)} supplied rows selected{!csv ? " · no matching records; choose another preset or hospital" : ""}.</p>}
    <p className="muted">Presets preserve the file’s IDs, timestamps and descriptions. Priority and coverage gaps are calculated by the server. Replaying existing IDs adds no new events.</p>
    <div className="action-row"><button className="btn" disabled={busy || !csv} onClick={() => void act(async () => { const result = await validateCsv(csv); setValidation(result.data); }, "Validation complete; no records were imported.")}>Validate CSV</button>
      <button className="btn btn-primary" disabled={busy || !csv} onClick={() => void act(async () => { const result = await mutate<ImportSummary>(`/api/v1/events/import?filename=${encodeURIComponent(filename)}&advance_clock=true`, undefined, { csv }); setValidation(result.result); setInjected(true); }, "Supplied events injected. Alerts and coverage refreshed from server evidence.")}>Inject supplied events</button></div>
    {validation && <div aria-label="Import summary"><p><strong>{validation.ok === false || (validation.error_count ?? 0) > 0 ? "CSV needs corrections" : "CSV check complete"}</strong></p><p>{validation.accepted ?? 0} accepted rows · {validation.duplicates ?? 0} duplicates skipped · {validation.error_count ?? validation.errors?.length ?? 0} errors.</p>
      {validation.clock_advanced_to && <p>Scenario time updated to {time(validation.clock_advanced_to)} ET.</p>}
      {validation.errors?.slice(0, 5).map((e, i) => <p key={i}>Row {e.row}: {e.error}</p>)}
      <details><summary>Technical import details</summary><pre>{JSON.stringify(validation, null, 2)}</pre></details></div>}
    {injected && <button className="btn btn-primary" onClick={onDesk}>Review coverage and alerts</button>}
    <h3>Scenario replay clock</h3><p>Advancing time expires offers and recalculates elapsed limits; it creates no operational events.</p><button className="btn" disabled={busy} onClick={() => void act(() => mutate("/api/v1/clock", { minutes: 5 }), "Scenario clock advanced by five minutes.")}>Advance 5 minutes</button>
    <h3>Imported batches</h3>{report.imports.map(i => <p key={i.import_id}>{i.filename} · {i.summary.accepted} accepted · {i.summary.duplicates} duplicates</p>)}
  </section><section className="panel"><h2>ActionLab · recorded replay</h2><p>Compare recommendations from the same recorded state. Observed outcomes are shared evidence; future clinical events and policy-specific outcome improvements are not generated.</p>
    <button className="btn btn-primary" disabled={busy} onClick={() => void act(async () => { const result = await get<Envelope<ActionLab>>("/api/v1/actionlab"); setLab(result.data); }, "Recorded comparison loaded.")}>Compare recorded policies</button>
    {lab && <div><p>{lab.observed_metrics.visible_event_count} supplied events · {lab.observed_metrics.unique_consults_with_receipt} recorded consults · {lab.generated_event_count} generated events</p>
      <p>Recorded time from consult receipt to first contact: median {number(lab.observed_metrics.received_to_first_recorded_contact.p50)} min · 95th percentile {number(lab.observed_metrics.received_to_first_recorded_contact.p95)} min ({lab.observed_metrics.received_to_first_recorded_contact.sample_size} records). These same observations apply to all policies.</p>
      <div className="table-scroll"><table><thead><tr><th>Policy</th><th>Evidence</th></tr></thead><tbody>{lab.policies.map(policy => <tr key={policy.policy}><td>{readable(policy.policy)}<small>{readable(policy.actual_source ?? policy.status)}</small></td><td>{policy.explanation}</td></tr>)}</tbody></table></div>
      <h3>Split-shift scope guard</h3><p>{lab.split_shift_trap.condition}</p>{lab.split_shift_trap.candidates.map(candidate => <p key={candidate.physician_id}>{candidate.physician_id}: scoped to {candidate.guarded_hospital_scope.join(", ")}; excludes {candidate.protected_from_unscoped_routing.join(", ") || "no additional hospitals"} from the proposed routing scope.</p>)}
      <details><summary>Reproducible source evidence</summary><pre data-testid="actionlab-result">{JSON.stringify(lab, null, 2)}</pre></details></div>}
  </section></div>;
}
