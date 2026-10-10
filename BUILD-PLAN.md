
# Sevaro Command Center

## Product Requirements Document & Engineering Build Plan

**Version:** 1.0 — Hackathon MVP
**Date:** October 10, 2026
**Product category:** Healthcare Operations / Physician Workforce Optimization
**Primary objective:** Predict coverage risks, optimize physician utilization, prioritize patient consultations, and support safe, explainable staffing decisions.

---

# Part I — Product Requirements Document

## 1. Executive Summary

Sevaro Command Center is an intelligent healthcare operations platform that connects physician availability, hospital coverage requirements, incoming consultation demand, and operational decision-making.

Rather than treating physician scheduling as a static calendar, the platform continuously evaluates whether available and potentially available physicians can satisfy consultation demand over the next 60–90 minutes.

It provides:

1. A live operational view of physician coverage and consult demand.
2. Early detection of impending staffing shortages and consultation delays.
3. Eligibility-aware physician recommendations.
4. Optimization of shift coverage, including potential split-shift interventions.
5. An explainable recommendation engine with optional Jev assistance.
6. Human approval, action tracking, and operational auditability.
7. Simulation and benchmarking using datasets with the same supplied format.

**Product principle:** The system recommends and explains operational interventions; authorized humans approve staffing changes. It does not make independent clinical treatment decisions.

## 2. Business Context

Sevaro provides virtual neurology and telestroke services. Its public Synapse AI materials describe capabilities including telemedicine scheduling, real-time communication, imaging, video, EHR integration, and documentation support.

Our product is a complementary **operations decision layer**, not a replacement for Synapse AI or an assumed integration with its internal systems.

### Problems to solve

- A physician may appear available in a schedule while actively handling another consultation.
- Multiple hospitals may need the same specialist simultaneously.
- A physician's shift may end shortly before a projected demand spike.
- Off-shift physicians may be technically qualified but not willing or permitted to accept a new shift.
- Different availability signals may disagree or arrive late.
- A seemingly good short-term reassignment can create a worse coverage gap later.
- Operations teams need to understand *why* an intervention is recommended.
- Unseen test data must work without rewriting the optimization logic.

## 3. Product Goals

| Goal                        | Expected capability                                                  |
| --------------------------- | -------------------------------------------------------------------- |
| Coverage visibility         | Show current and forecasted physician coverage                       |
| Proactive risk detection    | Identify shortages 60–90 minutes ahead                              |
| Consultation prioritization | Respect provided clinical urgency and deadlines                      |
| Eligibility                 | Enforce license, credential, specialty, and operational restrictions |
| Optimization                | Recommend feasible staffing and routing interventions                |
| Explainability              | Display selection reasons and rejection reasons                      |
| Human control               | Require approval before operational changes                          |
| Adaptability                | Accept new datasets in the supplied format                           |
| Evaluation                  | Compare baseline and optimized scenarios reproducibly                |

### Proposed MVP success criteria

- Zero recommendations marked assignable when a known hard eligibility constraint fails.
- Every candidate has a visible eligibility outcome and explanation.
- Duplicate event ingestion does not create duplicate consults or assignments.
- Late and conflicting events do not silently overwrite authoritative state.
- A new same-format dataset can be imported without application code changes.
- A recommendation can be approved, rejected, and audited.
- Event-to-dashboard updates target less than 5 seconds at demonstration scale.
- Optimization performance is measured against a reproducible baseline rather than assumed to improve outcomes.

These are engineering targets, not measured results.

## 4. Users and Roles

| User                   | Primary responsibility                                       |
| ---------------------- | ------------------------------------------------------------ |
| Operations Dispatcher  | Monitor coverage, review risks, approve interventions        |
| Physician              | Communicate availability and respond to coverage requests    |
| Hospital Coordinator   | Monitor consultations and escalation status                  |
| Clinical Administrator | Configure credentials, staffing rules, and coverage policies |
| Evaluator / Judge      | Inject scenarios, inspect decisions, compare results         |

## 5. Functional Requirements

### P0 — Required MVP

| ID    | Requirement                 | Acceptance criteria                                    |
| ----- | --------------------------- | ------------------------------------------------------ |
| FR-01 | Dataset import              | Validates and imports same-format datasets             |
| FR-02 | Physician directory         | Displays profiles, schedules, and known qualifications |
| FR-03 | Availability reconciliation | Combines signals with freshness and conflict handling  |
| FR-04 | Consult queue               | Shows urgency, status, waiting time, and assignment    |
| FR-05 | Coverage forecast           | Displays risk for the next 90 minutes                  |
| FR-06 | Eligibility engine          | Produces eligible, ineligible, or unverified outcomes  |
| FR-07 | Recommendation engine       | Ranks feasible candidates with explanations            |
| FR-08 | Intervention workflow       | Supports preview, approve, reject, and audit           |
| FR-09 | Live event ingestion        | Recalculates state without restarting the application  |
| FR-10 | Simulation                  | Compares baseline and recommended operations           |

### P1 — High-value enhancements

- Jev-assisted analysis and explanation.
- Monte Carlo demand simulation.
- Split-shift optimization.
- Physician fairness and workload balancing.
- Configurable hospital-specific coverage policies.
- Replay controls for operational events.
- Detailed confidence and data-quality indicators.

### P2 — Future product

- Authorized EHR/FHIR integrations.
- Sevaro integration if an official interface is available.
- Credential-document and CV extraction with human verification.
- Billing and reimbursement analytics.
- Physician self-service scheduling.
- Long-term workforce planning.
- Model training using sufficiently large, validated historical datasets.

## 6. Primary User Workflows

### Workflow A — Detect a coverage shortage

1. A physician's scheduled shift is approaching its end.
2. The system evaluates projected consultations and remaining qualified coverage.
3. It identifies a potential shortage 45 minutes ahead.
4. The dashboard displays the affected hospital, specialty, expected impact, and confidence.
5. The dispatcher opens the risk and reviews recommended interventions.

### Workflow B — Recommend a physician

1. The system identifies the requirements for an unassigned consultation or uncovered shift.
2. It evaluates every candidate against mandatory constraints.
3. Ineligible and unverified candidates are separated from feasible candidates.
4. Feasible candidates are ranked using predicted operational impact.
5. The dispatcher sees why each physician was selected or excluded.
6. Off-shift physicians are proposed for contact, not automatically assigned.

### Workflow C — Approve an intervention

1. The dispatcher previews the recommended change.
2. The system simulates downstream coverage impact.
3. The dispatcher approves, rejects, or modifies the proposal.
4. The backend rechecks constraints against current data.
5. Approved changes are recorded with the responsible actor and timestamp.
6. Coverage projections update immediately.

### Workflow D — Live scenario injection

1. An evaluator uploads or injects new events.
2. The system validates their format.
3. Accepted events are stored idempotently.
4. Materialized physician and consult states are updated.
5. Forecasts and recommendations are recomputed.
6. The dashboard displays the resulting operational changes.

---

# Part II — Decision and Optimization Design

## 7. Decision Engine Architecture

The engine has five stages:

**Ingestion → State Reconciliation → Risk Forecasting → Constraint Optimization → Human Decision**

### Stage 1: State reconciliation

The system must distinguish between:

- Scheduled availability.
- Self-reported availability.
- Active consultation status.
- Video or call activity.
- Technical heartbeat or connectivity.
- Approved overrides.

A heartbeat indicates connectivity, not necessarily clinical availability. An active consultation may imply workload even when a schedule indicates the physician is on shift.

Every signal includes a source, event time, ingestion time, and freshness policy.

Conflicting signals are resolved using explicit policies and recorded as conflicts when resolution is uncertain.

### Stage 2: Eligibility

Hard constraints are evaluated before ranking.

| Constraint          | Example                                            |
| ------------------- | -------------------------------------------------- |
| License             | Valid authorization for the patient's jurisdiction |
| Hospital privileges | Authorized for the facility, when required         |
| Specialty           | Appropriate qualifications for the consultation    |
| Credential validity | Required credentials have not expired              |
| Availability        | Not already committed beyond allowed capacity      |
| Scheduling          | No prohibited overlap                              |
| Rest and fatigue    | Meets configured scheduling limits                 |
| Consent             | Off-shift activation accepted before assignment    |
| Coverage continuity | Intervention does not violate mandatory coverage   |

Eligibility has three possible results:

- **Eligible:** All required constraints are satisfied.
- **Ineligible:** One or more known constraints fail.
- **Unverified:** A required field or authoritative confirmation is missing.

Unverified is not equivalent to eligible.

### Stage 3: Risk forecasting

Forecast coverage in 15-minute intervals:

- 0–15 minutes
- 15–30 minutes
- 30–45 minutes
- 45–60 minutes
- 60–75 minutes
- 75–90 minutes

Inputs include scheduled shift changes, current consultations, expected completion times, known demand, available capacity, and any supported historical arrival patterns.

For sparse datasets, use transparent rules and moving averages instead of training an unreliable predictive model.

Calculate projected demand and qualified physician capacity separately for each hospital, specialty, and interval.

### Stage 4: Optimization

The optimizer should minimize a configurable operational cost:

**Total cost =**

- Weighted consultation delay
- Weighted uncovered coverage minutes
- Overtime or activation cost
- Split-shift disruption
- Schedule-change instability
- Workload imbalance

Subject to all hard eligibility and staffing constraints.

Clinical urgency comes from validated source data or authorized clinical workflows, not from an LLM-generated diagnosis.

**Suggested technology:** Google OR-Tools CP-SAT for constrained assignment, with a deterministic greedy fallback.

The optimization result should contain:

- Recommended action.
- Eligible candidate.
- Expected coverage improvement.
- Predicted delay impact.
- Operational tradeoffs.
- Rejected alternatives.
- Relevant constraint explanations.

### Stage 5: Human decision

A recommendation is a proposal until authorized.

Approval must revalidate the current system state to avoid acting on a stale recommendation.

For an off-shift physician, dispatcher approval to contact the physician is distinct from physician acceptance and final assignment.

## 8. Avoiding the Split-Shift Trap

A short-term reassignment can improve immediate coverage while making a later shift impossible to staff.

The optimizer must evaluate the full forecast horizon before recommending a split shift.

A split-shift proposal must respect:

- Minimum continuous work blocks.
- Rest periods.
- Maximum allowed working time.
- Physician consent.
- Existing consultation continuity.
- Mandatory coverage at both the original and destination hospitals.

A proposal that solves the next 15 minutes but creates a critical shortage 60 minutes later should be rejected or explicitly flagged for further intervention.

## 9. Jev Integration

**Open dependency:** The identity and capabilities of Jev need confirmation.

Until defined, implement Jev as an optional advisory integration behind a stable interface.

### Proposed interface

Inputs:

- Current operational snapshot.
- Identified coverage risk.
- Feasible physician candidates.
- Forecasted demand.
- Existing recommendation and constraint explanations.

Outputs:

- Suggested candidate order or intervention.
- Explanation.
- Confidence or uncertainty, if supported.
- Advisory model/version metadata.

Rules:

1. Jev cannot override hard eligibility constraints.
2. Jev cannot independently activate or assign a physician.
3. Jev failure must not block the deterministic optimizer.
4. Jev outputs must be auditable.
5. Unsupported assertions are not presented as verified facts.

If Jev is an AI model, its initial value is explaining operational tradeoffs and comparing scenarios, not generating authoritative availability or credential data.

---

# Part III — Backend Engineering Plan

## 10. Recommended Backend Stack

| Layer             | Technology                         |
| ----------------- | ---------------------------------- |
| API               | Python 3.12 + FastAPI              |
| Validation        | Pydantic v2                        |
| Database          | PostgreSQL                         |
| ORM               | SQLAlchemy 2                       |
| Migrations        | Alembic                            |
| Optimization      | Google OR-Tools                    |
| Data processing   | Pandas or Polars                   |
| Tests             | Pytest + Hypothesis                |
| Containerization  | Docker                             |
| API documentation | OpenAPI                            |
| Authentication    | JWT validation with Amazon Cognito |

Use a modular monolith for the MVP. Microservices would introduce unnecessary operational complexity at this stage.

## 11. Backend Modules

### Module A — Data ingestion

Responsibilities:

- Accept file uploads and event payloads.
- Detect the dataset version and format.
- Validate required fields and data types.
- Normalize source records into internal models.
- Preserve original records for debugging and replay.
- Report rejected rows with precise reasons.
- Handle duplicate records and event IDs.
- Support replacing the dataset without redeployment.

**Important:** The canonical models below are proposed internal structures. They must not be mistaken for the developer kit's actual schema.

Build a source adapter that maps the verified supplied format into these models. Do not rename, discard, or invent source fields silently.

### Module B — Operational state

Responsibilities:

- Maintain current physician state.
- Maintain active consultations.
- Track shift changes.
- Reconcile availability events.
- Track source freshness and uncertainty.
- Provide an immutable event history.

### Module C — Eligibility service

Responsibilities:

- Evaluate hard constraints.
- Return structured pass/fail/unknown results.
- Support hospital-specific policy configuration.
- Explain every rejected candidate.
- Separate contact eligibility from assignment eligibility.

### Module D — Forecasting service

Responsibilities:

- Project demand and capacity across 90 minutes.
- Detect risk intervals.
- Assign operational severity.
- Report uncertainty and assumptions.
- Recalculate after material events.

### Module E — Optimization service

Responsibilities:

- Generate feasible assignment and staffing alternatives.
- Optimize across the full horizon.
- Compare recommendations against baseline.
- Provide fallback when the solver fails or times out.
- Produce deterministic results for the same inputs and configuration.

### Module F — Decision workflow

Responsibilities:

- Create intervention proposals.
- Manage approval and rejection.
- Revalidate before committing.
- Record changes and explanations.
- Track whether proposed interventions actually occurred.

### Module G — Jev adapter

Responsibilities:

- Convert the decision context into Jev's supported input.
- Validate Jev responses.
- Attach advisory explanations to recommendations.
- Record model/version metadata.
- Enforce timeout and fallback behavior.

## 12. Database Design

### Core tables

| Table                     | Important fields                                              |
| ------------------------- | ------------------------------------------------------------- |
| `physicians`            | id, specialty, status, metadata                               |
| `physician_credentials` | physician_id, jurisdiction, facility, credential_type, expiry |
| `hospitals`             | id, timezone, policy_configuration                            |
| `shifts`                | physician_id, start_at, end_at, status                        |
| `availability_signals`  | physician_id, source, value, observed_at, received_at         |
| `consultations`         | id, hospital_id, priority, requested_at, status, requirements |
| `assignments`           | consultation_id, physician_id, status, timestamps             |
| `coverage_risks`        | scope, interval, severity, explanation                        |
| `recommendations`       | run_id, action, candidate_id, score, reasons, status          |
| `dataset_imports`       | id, source_hash, schema_version, validation_report            |
| `raw_events`            | event_id, source, payload, event_time, received_at            |
| `simulation_runs`       | scenario_id, seed, baseline_metrics, optimized_metrics        |
| `audit_logs`            | actor, action, entity, before, after, timestamp               |

Use UTC timestamps internally and preserve the original source timezone or offset. Apply database uniqueness constraints for event identity and prevent concurrent conflicting assignments through transactions.

## 13. API Design

### Data and events

| Method | Endpoint                  | Purpose                      |
| ------ | ------------------------- | ---------------------------- |
| POST   | `/v1/datasets/validate` | Validate an incoming dataset |
| POST   | `/v1/datasets/import`   | Import a dataset             |
| POST   | `/v1/events`            | Ingest an operational event  |
| POST   | `/v1/events/batch`      | Ingest multiple events       |
| GET    | `/v1/events`            | Query event history          |

### Operations

| Method | Endpoint                            | Purpose                           |
| ------ | ----------------------------------- | --------------------------------- |
| GET    | `/v1/dashboard`                   | Current command center snapshot   |
| GET    | `/v1/physicians`                  | Physician list and states         |
| GET    | `/v1/consultations`               | Consultation queue                |
| GET    | `/v1/coverage/forecast`           | Coverage outlook                  |
| GET    | `/v1/risks`                       | Active coverage risks             |
| GET    | `/v1/physicians/{id}/eligibility` | Candidate eligibility explanation |

### Decisions

| Method | Endpoint                             | Purpose                           |
| ------ | ------------------------------------ | --------------------------------- |
| POST   | `/v1/optimizations/preview`        | Generate proposed interventions   |
| GET    | `/v1/recommendations/{id}`         | View recommendation details       |
| POST   | `/v1/recommendations/{id}/approve` | Approve after revalidation        |
| POST   | `/v1/recommendations/{id}/reject`  | Reject with optional reason       |
| POST   | `/v1/simulations`                  | Execute a reproducible simulation |
| GET    | `/v1/simulations/{id}`             | Retrieve metrics and comparison   |
| GET    | `/v1/audit`                        | Review operational decisions      |

Mutating endpoints require authorization and idempotency controls where appropriate.

## 14. Event Processing Pipeline

Processing sequence:

1. Receive the event.
2. Validate against the source adapter.
3. Check event identity and deduplicate.
4. Store the original event.
5. Reconcile the affected entity's state.
6. Mark dependent forecasts and recommendations stale.
7. Recompute affected coverage intervals.
8. Persist the updated snapshot.
9. Return the new snapshot version.
10. Update the frontend.

Out-of-order events must not simply overwrite newer state based on arrival order.

Use event timestamps, source sequencing when available, freshness policies, and explicit conflict resolution.

A replay of the same event history must produce the same state when the rules and configuration are unchanged.

## 15. Backend Repository Structure

Suggested modules:

- `app/api/` — routes and request handlers
- `app/schemas/` — Pydantic request/response contracts
- `app/models/` — database entities
- `app/adapters/` — source-specific dataset mappings
- `app/services/availability.py` — availability reconciliation
- `app/services/eligibility.py` — hard-constraint validation
- `app/services/forecast.py` — demand and capacity prediction
- `app/services/optimizer.py` — staffing optimization
- `app/services/decisions.py` — approval workflow
- `app/integrations/jev.py` — optional Jev adapter
- `app/simulation/` — replay and scenario execution
- `app/core/` — settings, authentication, logging
- `alembic/` — database migrations
- `tests/` — unit, integration, replay, and property-based tests

### Backend implementation order

**B1 — Data contract and adapters**

Deliver a documented mapping of actual supplied data fields into internal models. Build validation reports and support import of another same-format dataset.

**B2 — Event/state engine**

Implement raw event storage, deduplication, chronological reconciliation, and current-state queries.

**B3 — Eligibility engine**

Implement mandatory constraints, unknown-value handling, and explanation generation.

**B4 — Coverage forecasting**

Build 15-minute capacity and demand projections and identify coverage risks.

**B5 — Optimization**

Implement deterministic baseline, candidate ranking, and full-horizon assignment optimization.

**B6 — Approval and audit**

Build proposal lifecycle, optimistic concurrency checks, approval validation, and immutable audit records.

**B7 — Simulation and Jev**

Add seeded scenario replay, before/after metrics, and the optional advisory interface.

---

# Part IV — Frontend Engineering Plan

## 16. Recommended Frontend Stack

| Layer                | Technology                           |
| -------------------- | ------------------------------------ |
| Application          | React + TypeScript + Vite            |
| Styling              | Tailwind CSS                         |
| UI components        | shadcn/ui                            |
| Data fetching        | TanStack Query                       |
| Local UI state       | Zustand                              |
| Visualization        | Recharts                             |
| Forms and validation | React Hook Form + Zod                |
| Routing              | React Router                         |
| API typing           | Generated types from FastAPI OpenAPI |

A Vite single-page application is appropriate because the product is an authenticated operational dashboard, not an SEO-driven website.

## 17. Main Screens

### Screen 1 — Command Center

**Purpose:** Provide a complete operational overview.

Components:

- Active physicians.
- Current consultations.
- Unassigned consultations.
- At-risk hospitals.
- Next 90-minute coverage forecast.
- High-priority operational alerts.
- Pending interventions.
- Last successful data refresh.

### Screen 2 — Coverage Forecast

**Purpose:** Show where and when shortages will occur.

Components:

- Hospital and specialty filters.
- 90-minute timeline.
- Available versus required capacity.
- Coverage gap visualization.
- Forecast confidence or uncertainty.
- Risk explanations.
- Recommended interventions.

### Screen 3 — Physician Intelligence

**Purpose:** Understand the current physician workforce.

Components:

- Physician list and search.
- Current status and source freshness.
- Specialty and known qualifications.
- Shift start and end.
- Active consultation workload.
- Credential verification state.
- Eligibility explanations.
- Contact and activation status.

### Screen 4 — Consultation Queue

**Purpose:** Monitor patient consultation demand.

Components:

- Consultation identifier.
- Hospital.
- Source-provided urgency.
- Time waiting.
- Required specialty.
- Current assignment.
- Predicted delay.
- Escalation state.

Use de-identified or synthetic consultation data for the hackathon.

### Screen 5 — Intervention Decision Panel

**Purpose:** Review and act on recommendations.

Components:

- Risk summary.
- Recommended physician or action.
- Alternative candidates.
- Pass/fail eligibility explanations.
- Projected operational impact.
- Potential downstream coverage risk.
- Jev advisory explanation, if available.
- Approve/reject controls.
- Action status and audit history.

### Screen 6 — Simulation Lab

**Purpose:** Demonstrate measurable value and robustness.

Components:

- Dataset upload.
- Validation results.
- Scenario selector.
- Event replay.
- Run simulation.
- Baseline versus optimized comparison.
- Decision trace.
- Exportable metrics.

## 18. Frontend Interaction Requirements

- Refresh data every 3–5 seconds for the MVP.
- Highlight stale or conflicting physician availability.
- Distinguish real operational data from simulation.
- Show loading, empty, error, and disconnected states.
- Require confirmation for intervention approval.
- Prevent approval of stale recommendations.
- Make rejection reasons visible.
- Never hide hard eligibility failures behind a composite score.
- Preserve keyboard accessibility and readable contrast.

### Frontend implementation order

**F1:** Application shell, navigation, authentication, typed API client.

**F2:** Command Center cards, consult queue, physician status table.

**F3:** Coverage forecast timeline and risk detail panel.

**F4:** Candidate ranking, eligibility explanations, approval workflow.

**F5:** Dataset import, simulation comparison, event replay.

**F6:** Responsive layout, empty states, error handling, visual polish.

---

# Part V — AWS Architecture

## 19. Recommended Cloud Architecture

### Hackathon MVP

Use a simple AWS deployment with one containerized backend.

| Component          | AWS service            | Responsibility                             |
| ------------------ | ---------------------- | ------------------------------------------ |
| Frontend           | Amazon S3 + CloudFront | Static React application                   |
| Backend            | Amazon ECS Express     | Containerized FastAPI service              |
| Database           | Amazon RDS PostgreSQL  | Operational state and event history        |
| File storage       | Amazon S3              | Uploaded datasets and validation artifacts |
| Authentication     | Amazon Cognito         | User identity and JWT                      |
| Secrets            | AWS Secrets Manager    | Database credentials and API secrets       |
| Logs/metrics       | Amazon CloudWatch      | Application monitoring                     |
| Container registry | Amazon ECR             | Backend Docker images                      |
| Encryption         | AWS KMS                | Managed encryption keys where required     |

### Request flow

**User → CloudFront → React application → ECS API → PostgreSQL**

Dataset files are uploaded to S3 using short-lived, authorized upload URLs.

The backend validates the file, imports records, and triggers optimization.

### Networking

- Place RDS in private VPC subnets.
- Connect the ECS backend task security group to the private database on port 5432.
- Restrict database access to the backend security group.
- Use TLS for API and database connections.
- Configure VPC endpoints or controlled NAT access where outbound connectivity is required.
- Do not expose PostgreSQL publicly.

### Scale-up architecture

When event volume and background processing justify it, introduce:

- Amazon SQS for durable event processing.
- ECS Fargate workers for asynchronous forecasting and optimization.
- EventBridge Scheduler for periodic forecast refreshes.
- Transactional outbox processing to avoid losing committed events.
- Dead-letter queues and replay tools.
- Dedicated monitoring and alerting.

Do not introduce these components before the core system is functioning.

## 20. AWS Deployment Plan

### Step 1 — Provision infrastructure

Create:

- S3 bucket for frontend.
- CloudFront distribution with private S3 origin access.
- S3 bucket for datasets.
- ECR repository.
- RDS PostgreSQL instance.
- ECS backend service.
- Cognito user pool.
- Secrets Manager entries.
- CloudWatch log configuration.

Use the workshop AWS console or CLI directly. Start with the smallest deployment that runs the app, and add services only when needed.

### Step 2 — Containerize backend

Create a production Docker image containing:

- FastAPI application.
- Python dependencies.
- OR-Tools solver.
- Database client dependencies.
- Health-check endpoint.

### Step 3 — Configure database

- Run Alembic migrations.
- Create required indexes and uniqueness constraints.
- Configure database connection pooling.
- Seed only synthetic demo data.
- Verify backup and restore settings appropriate to the environment.

### Step 4 — Deploy frontend

- Build the React application.
- Publish static files to S3.
- Configure CloudFront.
- Configure frontend API base URL and Cognito settings.
- Test CORS and authentication.

### Step 5 — Set up CI/CD

GitHub Actions pipeline:

1. Lint and type-check.
2. Run unit and integration tests.
3. Build backend Docker image.
4. Push to ECR.
5. Deploy the ECS backend revision.
6. Apply database migrations safely.
7. Build and deploy frontend.
8. Run smoke tests.

Production deployment should separate database migration approval from automatic application rollout.

## 21. Security and Healthcare Data

For the hackathon, use synthetic or properly de-identified data.

Security requirements:

- Role-based access control.
- Hospital-scoped data authorization.
- Encryption at rest and in transit.
- No patient identifiers in application logs.
- Audit records for staffing decisions.
- Secrets stored outside source control.
- Restricted S3 access.
- API request validation and rate limiting.
- No uncontrolled transmission of sensitive records to Jev or other external models.

A real PHI deployment requires a separate HIPAA/security assessment, appropriate contractual arrangements including a BAA where applicable, and verification that the configured AWS services and integrations meet the organization's requirements.

---

# Part VI — Evaluation and Testing

## 22. Testing Strategy

### Unit tests

Test:

- Credential expiration.
- Specialty mismatch.
- Missing license information.
- Overlapping shifts.
- Physician already occupied.
- Stale availability signals.
- Conflicting status reports.
- Duplicate event ingestion.
- Split-shift constraint violations.
- Urgent consultation priority.

### Integration tests

Test the complete path from dataset import through forecasting, optimization, approval, and audit logging.

### Unseen-dataset tests

The evaluator may supply new data in the same source format.

Test with:

- Different physician identifiers.
- Different hospitals.
- Changed record ordering.
- Empty optional fields.
- Duplicate records.
- Missing noncritical values.
- Late-arriving events.
- Large event batches.
- Unfamiliar but schema-valid values.

No optimization rule should depend on a specific physician name, record position, or hardcoded hospital ID.

### Property-based tests

Verify invariants:

- Ineligible physicians cannot be approved for assignment.
- Replaying identical events does not duplicate state changes.
- Reordering independent events does not change the final state.
- An approved assignment cannot silently conflict with another approved assignment.
- Simulation results are reproducible with a fixed seed.

## 23. Evaluation Metrics

| Metric                    | Measurement                                       |
| ------------------------- | ------------------------------------------------- |
| Consultation waiting time | Mean, median, and P95                             |
| Urgent consult delay      | Time to eligible assignment                       |
| Coverage gap              | Uncovered qualified-capacity minutes              |
| Risk detection            | Recall and lead time on labeled scenarios         |
| Physician utilization     | Productive workload relative to eligible capacity |
| Overtime                  | Additional scheduled minutes                      |
| Fairness                  | Workload and activation distribution              |
| Recommendation validity   | Number of hard-constraint violations              |
| Decision latency          | Time from event to recommendation                 |
| Data robustness           | Import success and validation accuracy            |

Compare the optimizer against a defined baseline, such as first-available eligible physician or current scheduled coverage.

Report tradeoffs and failures, not only successful scenarios.

---

# Part VII — Delivery Plan

## 24. Team Workstreams

| Workstream   | Owner      | Main deliverable                      |
| ------------ | ---------- | ------------------------------------- |
| Backend/Data | Engineer 1 | Ingestion, state, APIs, database      |
| Optimization | Engineer 2 | Eligibility, forecasting, ranking     |
| Frontend     | Engineer 3 | Dashboard and decision workflow       |
| Cloud/QA     | Engineer 4 | AWS, CI/CD, testing, demo reliability |

If fewer than four developers are available, combine Cloud/QA with Backend and keep the initial optimization rule-based.

## 25. Priority-Ordered Build Schedule

The schedule below is designed for the October 11 noon submission deadline referenced earlier. The exact submission timezone remains to be verified.

| Phase        | Work                                                           | Deliverable               |
| ------------ | -------------------------------------------------------------- | ------------------------- |
| 0–2 hours   | Inspect developer-kit schema, create fixtures, agree contracts | Validated data model      |
| 2–5 hours   | Build ingestion, database, event reconciliation                | Working live state        |
| 5–8 hours   | Eligibility and basic forecasting                              | Risk detection            |
| 8–11 hours  | Deterministic ranking and optimization                         | Explained recommendations |
| 11–15 hours | Dashboard and intervention workflow                            | End-to-end UI             |
| 15–18 hours | AWS deployment and integration                                 | Accessible demo           |
| 18–21 hours | Simulation, unseen-data tests, Jev adapter if feasible         | Measured results          |
| Final buffer | Bug fixes, documentation, demo recording                       | Submission-ready system   |

These phases can overlap across team members.

### Critical path

**Dataset mapping → State engine → Eligibility → Forecast → Recommendation → Approval → Demonstration**

If time becomes constrained, protect this path before adding advanced forecasting, document extraction, or external integrations.

## 26. Five-Minute Demo

**0:00–0:40 — Problem**

Show an active hospital network with physicians, consultations, and scheduled coverage.

**0:40–1:30 — Detect**

Inject a physician unavailability event and show a future coverage risk.

**1:30–2:30 — Decide**

Display eligible candidates, rejected candidates, predicted impact, and an explained recommendation.

**2:30–3:20 — Act**

Approve the intervention and show updated coverage and audit history.

**3:20–4:20 — Validate**

Run the baseline-versus-optimized simulation and display measured results.

**4:20–5:00 — Robustness**

Load a second same-format dataset or replay duplicate/out-of-order events without restarting the application.

## 27. Open Dependencies

1. **Actual dataset schema:** Inspect the Sevaro developer kit before finalizing source adapters and data-dependent constraints.
2. **Jev:** Confirm what Jev is, its API or operating model, and what data it can safely receive.
3. **Credentialing:** Determine which fields are supplied and which must remain unverified.
4. **Operational policies:** Confirm actual hospital-specific staffing and shift rules.
5. **Evaluation criteria:** Confirm judge-provided event injection protocol, scoring metrics, and dataset format.
6. **Deadline:** Confirm the submission timezone.

## 28. MVP Definition of Done

The MVP is complete when a user can:

1. Import a valid same-format dataset.
2. View physician and consultation states.
3. Inject a live event.
4. Observe a recalculated 90-minute coverage forecast.
5. Review a recommendation with eligibility explanations.
6. Approve or reject an intervention.
7. Inspect the audit record.
8. Run a baseline-versus-optimized simulation.
9. Repeat the workflow with a different same-format dataset without modifying application code.

**Final product principle:** Eligibility first, optimization second, explanation third, human authorization before action.
