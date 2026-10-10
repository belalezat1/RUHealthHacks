import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api, request } from "../api/client";
import { useDashboard } from "../api/hooks";
import type { Eligibility } from "../api/types";
import { EligibilityDetails } from "../components/EligibilityDetails";
import {
  Badge,
  Empty,
  ErrorNotice,
  Icon,
  Loading,
  PageHeading,
  Panel,
  datetime,
  human,
  time,
  tone,
} from "../components/ui";
export default function Physicians() {
  const [params] = useSearchParams();
  const [selected, setSelected] = useState(params.get("physician") ?? "");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [consultation, setConsultation] = useState("");
  const [action, setAction] = useState("contact");
  const dashboard = useDashboard();
  const physicians = useQuery({
    queryKey: ["physicians"],
    queryFn: ({ signal }) => api.physicians(signal),
    refetchInterval: 3000,
  });
  const physician = physicians.data?.find((p) => p.id === selected);
  const consult = dashboard.data?.consultations.find(
    (c) => c.id === consultation,
  );
  const eligibility = useQuery({
    queryKey: [
      "eligibility",
      selected,
      consultation,
      action,
      dashboard.data?.source_version,
    ],
    queryFn: ({ signal }) =>
      request<Eligibility>(
        `/physicians/${encodeURIComponent(selected)}/eligibility?hospital_id=${encodeURIComponent(consult!.hospital_id)}&consultation_id=${encodeURIComponent(consultation)}&action=${action}`,
        { signal },
      ),
    enabled: !!physician && !!consult,
  });
  const filtered = physicians.data?.filter(
    (p) =>
      (!search ||
        `${p.name} ${p.specialties.join(" ")} ${p.id}`
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (!status || p.availability.status === status),
  );
  return (
    <>
      <PageHeading
        title="Physician Intelligence"
        description="Qualifications, commitments, and the evidence behind availability."
      />
      <div className="toolbar">
        <label className="search-field">
          <Icon name="search" size={18} />
          <input
            aria-label="Search physicians"
            placeholder="Search physician or specialty…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {[
              ...new Set(physicians.data?.map((p) => p.availability.status)),
            ].map((s) => (
              <option key={s} value={s}>
                {human(s)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ErrorNotice
        error={physicians.error}
        retry={() => void physicians.refetch()}
      />
      {physicians.isPending ? (
        <Loading />
      ) : (
        <div className={`directory-layout ${physician ? "with-detail" : ""}`}>
          <Panel
            title="Physician directory"
            subtitle={`${filtered?.length ?? 0} matching physicians`}
          >
            {filtered?.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Physician</th>
                      <th>Availability</th>
                      <th>Workload</th>
                      <th>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p) => (
                      <tr
                        key={p.id}
                        className={selected === p.id ? "selected-row" : ""}
                      >
                        <td>
                          <button
                            className="table-button"
                            onClick={() => setSelected(p.id)}
                          >
                            {p.name}
                          </button>
                          <small>{p.specialties.map(human).join(", ")}</small>
                        </td>
                        <td>
                          <Badge tone={tone(p.availability.status)} dot>
                            {human(p.availability.status)}
                          </Badge>
                          <small>
                            {p.availability.on_shift ? "On shift" : "Off shift"}
                          </small>
                        </td>
                        <td>
                          <strong>
                            {p.availability.workload} / {p.max_concurrent}
                          </strong>
                          <small>Concurrent work</small>
                        </td>
                        <td>
                          <Badge
                            tone={
                              p.availability.stale
                                ? "amber"
                                : p.availability.connected
                                  ? "green"
                                  : "gray"
                            }
                          >
                            {p.availability.stale
                              ? "Stale signal"
                              : p.availability.connected
                                ? "Connected"
                                : "Disconnected"}
                          </Badge>
                          {p.availability.conflicts.length > 0 && (
                            <small className="text-warning">
                              {p.availability.conflicts.length} conflicts
                            </small>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No matching physicians">
                Import a dataset or update your filters.
              </Empty>
            )}
          </Panel>
          {physician && (
            <Panel
              title={physician.name}
              subtitle={physician.id}
              action={
                <button
                  className="icon-button"
                  aria-label="Close physician details"
                  onClick={() => setSelected("")}
                >
                  <Icon name="close" />
                </button>
              }
            >
              <div className="detail-body">
                <div className="subheading">
                  <Badge tone={tone(physician.availability.status)}>
                    {human(physician.availability.status)}
                  </Badge>
                  <span className="muted">
                    Capacity {physician.max_concurrent}
                  </span>
                </div>
                <h3>Qualifications</h3>
                {physician.credentials?.length ? (
                  physician.credentials.map((c) => (
                    <div className="compact-row" key={c.id}>
                      <div>
                        <strong>{human(c.kind)}</strong>
                        <small>
                          {c.jurisdiction ??
                            dashboard.data?.hospitals.find(
                              (h) => h.id === c.hospital_id,
                            )?.name ??
                            c.hospital_id}
                        </small>
                      </div>
                      <span
                        className={
                          c.expires_at && Date.parse(c.expires_at) < Date.now()
                            ? "text-danger"
                            : "muted"
                        }
                      >
                        {c.expires_at
                          ? `Expires ${datetime(c.expires_at)}`
                          : "Validity not supplied"}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="muted">No credential evidence supplied.</p>
                )}
                <h3>Shift commitments</h3>
                {physician.shifts?.length ? (
                  physician.shifts.map((s) => (
                    <div className="compact-row" key={s.id}>
                      <div>
                        <strong>
                          {dashboard.data?.hospitals.find(
                            (h) => h.id === s.hospital_id,
                          )?.name ?? s.hospital_id}
                        </strong>
                        <small>
                          {datetime(s.start_at)} – {time(s.end_at)}
                        </small>
                      </div>
                      <Badge tone={s.mandatory ? "amber" : "gray"}>
                        {s.mandatory ? "Mandatory" : human(s.status)}
                      </Badge>
                    </div>
                  ))
                ) : (
                  <p className="muted">No scheduled shifts supplied.</p>
                )}
                <h3>Active work and contact state</h3>
                {dashboard.data?.consultations
                  .filter(
                    (c) =>
                      c.physician_id === physician.id &&
                      ["assigned", "active"].includes(c.status),
                  )
                  .map((c) => (
                    <div className="compact-row" key={c.id}>
                      <div>
                        <strong>{c.id}</strong>
                        <small>
                          {c.duration_minutes} min · Due {time(c.deadline_at)}
                        </small>
                      </div>
                      <Badge tone={tone(c.status)}>{human(c.status)}</Badge>
                    </div>
                  ))}
                {dashboard.data?.recommendations
                  .filter((r) => r.candidate.physician_id === physician.id)
                  .map((r) => (
                    <Link
                      to={`/interventions?proposal=${encodeURIComponent(r.id)}`}
                      className="compact-row"
                      key={r.id}
                    >
                      <div>
                        <strong>{r.candidate.consultation_id}</strong>
                        <small>Contact / decision {r.id.slice(0, 12)}</small>
                      </div>
                      <Badge tone={tone(r.status)}>{human(r.status)}</Badge>
                    </Link>
                  ))}
                {!dashboard.data?.recommendations.some(
                  (r) => r.candidate.physician_id === physician.id,
                ) &&
                  physician.availability.workload === 0 && (
                    <p className="muted">
                      No active consultations or contact requests.
                    </p>
                  )}
                <h3>Availability signals</h3>
                {physician.availability.signals?.map((s) => (
                  <div className="compact-row" key={s.id}>
                    <div>
                      <strong>
                        {human(s.kind)} · {s.value}
                      </strong>
                      <small>{s.source}</small>
                    </div>
                    <small>{datetime(s.observed_at)}</small>
                  </div>
                ))}
                {physician.availability.conflicts.length > 0 && (
                  <div className="notice notice-warning">
                    <div>
                      <strong>Conflicting evidence</strong>
                      {physician.availability.conflicts.map((c, i) => (
                        <p key={i}>{human(c)}</p>
                      ))}
                    </div>
                  </div>
                )}
                <h3>Check eligibility</h3>
                <label>
                  Consultation
                  <select
                    value={consultation}
                    onChange={(e) => setConsultation(e.target.value)}
                  >
                    <option value="">Choose consultation</option>
                    {dashboard.data?.consultations
                      .filter((c) => c.status === "waiting")
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.id} · {c.specialty}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Intended action
                  <select
                    value={action}
                    onChange={(e) => setAction(e.target.value)}
                  >
                    <option value="contact">Contact physician</option>
                    <option value="assign">Assign consultation</option>
                  </select>
                </label>
                <ErrorNotice error={eligibility.error} />
                {eligibility.isFetching ? (
                  <Loading label="Checking evidence…" />
                ) : eligibility.data ? (
                  <EligibilityDetails eligibility={eligibility.data} />
                ) : (
                  <p className="muted">
                    Select a consultation to evaluate its specific requirements.
                  </p>
                )}
              </div>
            </Panel>
          )}
        </div>
      )}
    </>
  );
}
