# Synthetic data and operational assumptions

This application is an operations demonstration using invented, explicitly labeled physicians, facilities, credentials, and consultation records. It does not establish real clinical urgency, staffing policy, licensure, patient outcomes, or an integration with Sevaro Synapse.

The authoritative implementation inputs are BUILD-PLAN.md, the accompanying architecture diagram, and the supplied master build guide. Where the master guide changes an older architecture choice, the implementation follows the guide. The official developer-kit format has not been supplied. `SevaroAdapter` therefore reports unavailable instead of guessing a mapping.

`synthetic_v1` is a JSON object with a dataset ID, an observation anchor, and arrays of hospitals, physicians, credentials, shifts, signals, and consultations. Each record uses a source ID. IDs need only be unique within their entity type and dataset. The canonical import schema is exposed in the backend source and validation API. JSON uploads are parsed by the frontend and validated again by the API; invalid imports leave the active dataset untouched. Maximum request size is 2MB, maximum rows 10,000. Batch ingestion is atomic, with at most 100 events.

Original dataset payloads, offsets, schema version, content hash, and validation report are retained in PostgreSQL. Operational timestamps are UTC. Example fixtures and seed commands shift all fixture dates relative to the current UTC clock, preserving their intervals. The seed command is a no-op when that dataset already exists; an explicit reset rebases its dates and preserves audit history.

The demo supports one active consultation per physician. Database partial unique indexes enforce that constraint and one active assignment per consultation. Every material operational mutation locks the shared active-state row. Reads obtain a shared lock for a consistent multi-table snapshot. This favors correctness at demo scale over throughput.

Policy assumptions are versioned in `config/demo_policies.json`. A heartbeat is connectivity evidence only. Self-report, activity, workload, shift timing, and credentials remain separate. Missing required evidence means unverified. Contact eligibility permits offering an off-shift block; assignment needs scoped physician consent and all current hard rules. Synthetic physician response buttons act as visibly identified local actors, never as real outreach.

The forecast compares clinician work-minutes with allocated qualified capacity across six 15-minute intervals. Aggregate capacity is shared across hospitals. Displayed severity is a deterministic operations label; clinical priority is copied from supplied consultation records. No confidence percentage is invented for understaffing.

Jev receives a compact shortlist of already feasible plans and limited synthetic operations notes. It is advisory only. Mock outputs are deterministic and labeled. Its score is a rubric index, and confidence describes the model's answer distribution. Neither represents clinical safety or a measured coverage probability.

Production rejects demo authentication. Cognito API access requires signed access tokens with matching issuer, client, expiration, and token use. Role comes from authorized group claims, hospital scope from a trusted access-token claim, and physician ID from a trusted identity claim. Those claims and hosted login must be provisioned and verified before any public deployment.
