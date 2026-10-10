import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAction, useDashboard } from "../api/hooks";
import type {
  DecisionAction,
  PreviewMethod,
  Recommendation,
} from "../api/types";
import { EligibilityDetails } from "../components/EligibilityDetails";
import {
  Badge,
  Empty,
  ErrorNotice,
  Icon,
  JsonDetails,
  Loading,
  PageHeading,
  Pagination,
  Panel,
  datetime,
  human,
  time,
  tone,
} from "../components/ui";

export default function Interventions() {
  const [params, setParams] = useSearchParams();
  const [consultation, setConsultation] = useState(
    params.get("consultation") ?? "",
  );
  const [method, setMethod] = useState<PreviewMethod>("greedy");
  const [reason, setReason] = useState("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [auditOffset, setAuditOffset] = useState(0);
  const [activationId, setActivationId] = useState("");
  const selected = params.get("proposal") ?? "";
  const dashboard = useDashboard();
  const client = useQueryClient();
  const recommendation = useQuery({
    queryKey: ["recommendation", selected],
    queryFn: ({ signal }) => api.recommendation(selected, signal),
    enabled: !!selected,
    refetchInterval: 3000,
  });
  const audit = useQuery({
    queryKey: ["audit", auditOffset],
    queryFn: () => api.audit(auditOffset),
    refetchInterval: 3000,
  });
  const preview = useAction((id: string) => api.preview(id, method));
  const decision = useAction(
    ({ action, accepted }: { action: DecisionAction; accepted?: boolean }) =>
      api.decision(
        selected,
        action,
        { reason, ...(accepted !== undefined ? { accepted } : {}) },
        action === "physician-response" && recommendation.data
          ? {
              role: "physician",
              id: recommendation.data.candidate.physician_id,
            }
          : undefined,
      ),
  );
  const activation = useAction(async () => {
    const rec = recommendation.data!;
    return api.event({
      dataset_id: dashboard.data!.dataset_id!,
      source: "synthetic-ui",
      event_id: crypto.randomUUID(),
      event_type: "activation",
      entity_id: rec.candidate.physician_id,
      observed_at: new Date().toISOString(),
      payload: { recommendation_id: rec.id },
    });
  });
  const rec = recommendation.data;
  const busy = preview.isPending || decision.isPending || activation.isPending;
  const select = (r: Recommendation) => {
    setParams({ proposal: r.id, consultation: r.candidate.consultation_id });
    setConsultation(r.candidate.consultation_id);
    setConsentConfirmed(false);
    setActivationId("");
    setReason("");
    decision.reset();
    activation.reset();
  };
  const act = (action: DecisionAction, accepted?: boolean) =>
    decision.mutate(
      { action, accepted },
      {
        onSuccess: (r) => {
          client.setQueryData(["recommendation", r.id], r);
          setReason("");
          setConsentConfirmed(false);
        },
      },
    );
  const pName =
    dashboard.data?.physicians.find((p) => p.id === rec?.candidate.physician_id)
      ?.name ?? rec?.candidate.physician_id;
  return (
    <>
      <PageHeading
        title="Intervention Panel"
        description="Review the plan. Inspect its evidence. Keep each decision accountable."
      />
      <Panel
        title="Find feasible coverage"
        subtitle="A preview evaluates hard constraints before ranking candidates."
      >
        <div className="form-row padded">
          <label className="grow">
            Waiting consultation
            <select
              value={consultation}
              onChange={(e) => setConsultation(e.target.value)}
            >
              <option value="">Select a consultation</option>
              {dashboard.data?.consultations
                .filter((c) => c.status === "waiting")
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} ·{" "}
                    {dashboard.data?.hospitals.find(
                      (h) => h.id === c.hospital_id,
                    )?.name ?? c.hospital_id}{" "}
                    · {c.priority}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Ranking method
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as PreviewMethod)}
            >
              <option value="greedy">Deterministic greedy</option>
              <option value="baseline">Baseline</option>
              <option value="cp_sat">Bounded CP-SAT</option>
            </select>
          </label>
          <button
            className="button primary"
            disabled={!consultation || busy}
            onClick={() => preview.mutate(consultation, { onSuccess: select })}
          >
            <Icon name="spark" size={17} />
            {preview.isPending ? "Evaluating…" : "Preview recommendation"}
          </button>
        </div>
        <div className="padded-horizontal">
          <ErrorNotice
            error={preview.error}
            retry={() => void client.invalidateQueries()}
          />
        </div>
      </Panel>
      <div className="intervention-layout">
        <aside>
          <Panel
            title="Proposals"
            subtitle={`${dashboard.data?.recommendations.length ?? 0} in active dataset`}
          >
            {dashboard.data?.recommendations.length ? (
              <div className="proposal-list">
                {dashboard.data.recommendations.map((r) => (
                  <button
                    key={r.id}
                    className={`proposal-item ${selected === r.id ? "active" : ""}`}
                    onClick={() => select(r)}
                  >
                    <Badge tone={tone(r.status)}>{human(r.status)}</Badge>
                    <strong>
                      {dashboard.data?.physicians.find(
                        (p) => p.id === r.candidate?.physician_id,
                      )?.name ??
                        r.candidate?.physician_id ??
                        r.id}
                    </strong>
                    <small>{r.candidate?.consultation_id}</small>
                    <small>
                      {r.candidate?.action === "activate"
                        ? "Off-shift activation"
                        : "Consultation routing"}
                    </small>
                  </button>
                ))}
              </div>
            ) : (
              <Empty title="No proposals yet">
                Select a waiting consultation to begin.
              </Empty>
            )}
          </Panel>
          <div className="workflow-guide">
            <h3>Decision workflow</h3>
            <ol>
              {[
                "Review proposal",
                "Approve for contact",
                "Record physician consent",
                "Commit assignment",
                "Observe activation",
                "Verify outcome",
              ].map((s, i) => (
                <li key={s}>
                  <span>{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
            <p>
              Every step is persisted and audited. A projected benefit becomes
              verified only with activation evidence.
            </p>
          </div>
        </aside>
        <div>
          {recommendation.isFetching && !rec ? (
            <Loading label="Loading proposal…" />
          ) : null}
          <ErrorNotice error={recommendation.error} />
          {rec ? (
            <Panel
              title={
                rec.candidate.action === "activate"
                  ? "Activate additional coverage"
                  : "Route waiting consultation"
              }
              subtitle={`Proposal ${rec.id} · Workflow v${rec.workflow_version}`}
              action={
                <Badge tone={tone(rec.status)}>{human(rec.status)}</Badge>
              }
            >
              <div className="detail-body">
                <div className="proposal-summary">
                  <span className="avatar large">
                    {pName
                      ?.replace(/^Dr\.\s*/, "")
                      .split(" ")
                      .slice(0, 2)
                      .map((s) => s[0])
                      .join("")}
                  </span>
                  <div>
                    <h2>{pName}</h2>
                    <p>
                      {dashboard.data?.hospitals.find(
                        (h) => h.id === rec.candidate.hospital_id,
                      )?.name ?? rec.candidate.hospital_id}{" "}
                      · {rec.candidate.consultation_id}
                    </p>
                    <small>
                      {time(rec.candidate.start_at)}–
                      {time(rec.candidate.end_at)} · Expires{" "}
                      {time(rec.expires_at)} · Source v{rec.source_version}
                    </small>
                  </div>
                </div>
                <div className="explanation-box">
                  <strong>Why this plan</strong>
                  <p>
                    {Array.isArray(rec.candidate.explanation)
                      ? rec.candidate.explanation.join(" ")
                      : rec.candidate.explanation}
                  </p>
                </div>
                <div className="effect-grid">
                  {Object.entries(rec.candidate.expected_effect ?? {})
                    .filter(
                      ([, value]) =>
                        value !== null && typeof value !== "object",
                    )
                    .map(([key, value]) => (
                      <div key={key}>
                        <small>{human(key)}</small>
                        <strong>{human(value)}</strong>
                      </div>
                    ))}
                </div>
                <p className="muted small-text">
                  Expected effects are projections until verification completes.
                </p>
                <JsonDetails
                  title="Projected effects and downstream analysis"
                  value={rec.candidate.expected_effect}
                />
                <EligibilityDetails eligibility={rec.candidate.eligibility} />
                <details className="evidence-section">
                  <summary>
                    Alternatives and rejected candidates (
                    {rec.alternatives.length + rec.rejected.length})
                  </summary>
                  {rec.alternatives.map((c) => (
                    <div className="detail-card" key={c.physician_id}>
                      <strong>
                        {dashboard.data?.physicians.find(
                          (p) => p.id === c.physician_id,
                        )?.name ?? c.physician_id}
                      </strong>
                      <p>{human(c.explanation)}</p>
                      <EligibilityDetails eligibility={c.eligibility} />
                    </div>
                  ))}
                  {rec.rejected.map((c, i) => (
                    <div className="detail-card" key={`${c.physician_id}-${i}`}>
                      <strong>
                        {dashboard.data?.physicians.find(
                          (p) => p.id === c.physician_id,
                        )?.name ?? c.physician_id}
                      </strong>
                      {c.eligibility ? (
                        <EligibilityDetails eligibility={c.eligibility} />
                      ) : (
                        <JsonDetails title="Rejection evidence" value={c} />
                      )}
                    </div>
                  ))}
                  {rec.alternatives.length + rec.rejected.length === 0 && (
                    <p className="muted">
                      No other candidates in this dataset.
                    </p>
                  )}
                </details>
                <div className="jev-panel">
                  <div className="subheading">
                    <h3>
                      <Icon name="spark" size={17} /> Jev advisory
                    </h3>
                    <Badge tone="gray">
                      {human(rec.advisory?.mode ?? dashboard.data?.jev.mode)}
                    </Badge>
                  </div>
                  <div className="advisory-status">
                    <Badge
                      tone={
                        ["unavailable", "invalid", "stale"].includes(
                          String(rec.advisory?.status),
                        )
                          ? "amber"
                          : "gray"
                      }
                    >
                      {human(
                        rec.advisory?.status ?? dashboard.data?.jev.status,
                      )}
                    </Badge>
                    <span>
                      Model:{" "}
                      {human(rec.advisory?.model ?? dashboard.data?.jev.model)}
                    </span>
                  </div>
                  {rec.advisory?.message ? (
                    <p>{human(rec.advisory.message)}</p>
                  ) : null}
                  <p>
                    Advisory judgments do not override eligibility, clinical
                    priority, or human approval.
                  </p>
                  <JsonDetails
                    title="Advisory status and model evidence"
                    value={rec.advisory ?? dashboard.data?.jev}
                  />
                </div>
                <JsonDetails
                  title="Solver results and assumptions"
                  value={{ solver: rec.solver, assumptions: rec.assumptions }}
                />
                <ErrorNotice
                  error={decision.error ?? activation.error}
                  retry={() => void client.invalidateQueries()}
                />
                {[
                  "proposed",
                  "approved_for_contact",
                  "physician_accepted",
                  "assigned",
                ].includes(rec.status) ? (
                  <div className="decision-actions">
                    <label>
                      Decision reason
                      <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Record why you are taking this action…"
                        rows={2}
                      />
                    </label>
                    {rec.status === "proposed" && (
                      <div className="button-row">
                        <button
                          className="button primary"
                          disabled={busy || !reason.trim()}
                          onClick={() => act("approve")}
                        >
                          <Icon name="check" size={16} />
                          Approve for contact
                        </button>
                        <button
                          className="button danger"
                          disabled={busy || !reason.trim()}
                          onClick={() => act("reject")}
                        >
                          Reject proposal
                        </button>
                      </div>
                    )}
                    {rec.status === "approved_for_contact" && (
                      <div className="consent-box">
                        <Badge tone="amber">Synthetic physician actor</Badge>
                        <p>
                          Record the demo response as <strong>{pName}</strong>.
                          Supervisor approval is not physician consent.
                        </p>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={consentConfirmed}
                            onChange={(e) =>
                              setConsentConfirmed(e.target.checked)
                            }
                          />{" "}
                          I am explicitly simulating this physician’s response.
                        </label>
                        <div className="button-row">
                          <button
                            className="button primary"
                            disabled={
                              busy || !reason.trim() || !consentConfirmed
                            }
                            onClick={() => act("physician-response", true)}
                          >
                            Accept as synthetic physician
                          </button>
                          <button
                            className="button danger"
                            disabled={
                              busy || !reason.trim() || !consentConfirmed
                            }
                            onClick={() => act("physician-response", false)}
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    )}
                    {rec.status === "physician_accepted" && (
                      <>
                        <p className="muted">
                          The server will recheck credentials, availability,
                          consent, and downstream coverage before assignment.
                        </p>
                        <button
                          className="button primary"
                          disabled={busy || !reason.trim()}
                          onClick={() => act("commit")}
                        >
                          Revalidate and commit assignment
                        </button>
                      </>
                    )}
                    {rec.status === "assigned" && (
                      <>
                        <p className="muted">
                          Assignment is recorded. Send a separate synthetic
                          activation event, then verify against the stored
                          evidence.
                        </p>
                        <div className="button-row">
                          <button
                            className="button"
                            disabled={busy || !!activationId}
                            onClick={() =>
                              activation.mutate(undefined, {
                                onSuccess: (result) =>
                                  setActivationId(result.event_id),
                              })
                            }
                          >
                            {activationId
                              ? "Activation event recorded"
                              : "Inject synthetic activation"}
                          </button>
                          <button
                            className="button primary"
                            disabled={busy || !reason.trim()}
                            onClick={() => act("verify")}
                          >
                            Verify activation evidence
                          </button>
                        </div>
                        {activationId && (
                          <p className="success-text">
                            Stored event: {activationId}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <div
                    className={`notice ${rec.status === "verified" ? "notice-success" : "notice-warning"}`}
                  >
                    <Icon
                      name={rec.status === "verified" ? "check" : "alert"}
                    />
                    <div>
                      <strong>{human(rec.status)}</strong>
                      <p>
                        {rec.status === "verified"
                          ? "The server confirmed stored activation evidence for this assignment."
                          : "This proposal cannot advance. Create a fresh preview for any remaining waiting consultation."}
                      </p>
                      {rec.status === "verified" && rec.verification && (
                        <>
                          <p>
                            <strong>
                              {rec.verification.remaining_gap === true
                                ? "Coverage gaps remain at this hospital."
                                : "No remaining gap in the checked hospital intervals."}
                            </strong>
                          </p>
                          <p>{human(rec.verification.coverage_note)}</p>
                          <JsonDetails
                            title="Verified activation and remaining coverage"
                            value={rec.verification}
                          />
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Panel>
          ) : (
            <Panel>
              <Empty title="Select a proposal to review">
                Inspect eligibility and downstream effects before authorizing
                any change.
              </Empty>
            </Panel>
          )}
        </div>
      </div>
      <Panel
        title="Decision audit"
        subtitle="Application append-only records of actors, reasons, and state changes"
      >
        <ErrorNotice error={audit.error} />
        {audit.data?.items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Reason / evidence</th>
                </tr>
              </thead>
              <tbody>
                {audit.data.items.map((a) => (
                  <tr key={a.id}>
                    <td className="mono">{datetime(a.created_at)}</td>
                    <td>
                      <strong>{human(a.action)}</strong>
                      <small>{a.entity_id}</small>
                    </td>
                    <td>
                      {a.actor}
                      <small>{a.role}</small>
                    </td>
                    <td>
                      {a.reason}
                      <JsonDetails
                        title="Before / after"
                        value={{ before: a.before, after: a.after }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No audit records yet">
            Imports and operational decisions will appear here.
          </Empty>
        )}
        <Pagination
          offset={auditOffset}
          total={audit.data?.total ?? 0}
          onChange={setAuditOffset}
        />
      </Panel>
    </>
  );
}
