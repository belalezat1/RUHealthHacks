# Jev decision contract and recorded ActionLab

## Boundary

The application uses TypeSafe's Jev family through its native HTTP Choice primitive.
The integration was checked against the live [API reference](https://docs.typesafe.ai/api),
[Choice guidance](https://docs.typesafe.ai/primitives/choice),
[function-calling cookbook](https://docs.typesafe.ai/cookbooks/function_calling), and
[confidence documentation](https://docs.typesafe.ai/confidence) on October 11, 2026.

Code computes state, hospital target, eligibility, hours, ETA, scope, and immutable
offer terms. Jev selects one admitted staffing recommendation or escalation. It
cannot generate physicians, change scope/terms, authorize outreach, declare an
accepted physician online, or infer compensation, clinical quality, or STAT status.
Clinical risk prioritization remains visible independently of the staffing preview.

There is no runtime mock AI adapter. Test-only HTTP transports inject failures and
native response shapes without adding records to application datasets.

## Application interface

```python
from backend.intelligence.decisions import DecisionEngine

engine = DecisionEngine()  # Server environment only.
decision = await engine.select(
    report, run_id=run_id, revision=revision,
    current_revision=current_revision_callback,  # Optional early freshness check.
)
await engine.aclose()  # During application shutdown.
```

The service performs the provider request outside its database transaction, then
persists the immutable result at the captured run/revision. A later offer proposal
must reference its `decision_id`, match the selected action, and revalidate the
current run, revision, actor permissions, eligibility and offer exclusivity in the
same transaction that creates the proposal. A decision is a recommendation, not an
authorization. Stale evidence is never applied as a current staffing decision.

The result includes:

| Field | Meaning |
| --- | --- |
| `decision_id`, `input_hash` | Immutable decision identity and stable hash binding input to actual offer terms |
| `scope` | `staffing`; does not replace clinical-risk actions |
| `run_id`, `revision`, `as_of`, `policy_version` | Evidence and policy identity |
| `status` | `ready`, `escalated`, or `stale` |
| `selected_action_id`, `selected_action`, `selected_physician_ids` | Selected code-defined action; stale decisions have no selected action |
| `actions`, `feasible_actions` | Same bounded action list, including explicit escalation |
| `baseline_action_id` | Deterministic fallback computed before contacting Jev |
| `source` | Actual selector: `jev`, `deterministic_fallback`, or code-only `escalation` |
| `fallback_reason` | Stable failure/uncertainty reason; no exception strings or provider error body |
| `model`, `confidence`, `latency_ms` | Convenient aliases of provider evidence |
| `provider` | Provider status, requested/resolved model, complete probabilities, usage, latency and configured threshold |
| `requires_clinical_lead_approval` | Always true |

A scoped offer action contains its `action_id`, `kind="scoped_split_shift"`,
`physician_ids`, singleton `physician_id` where applicable, target-only
`offer_hospitals`, `window_start`, `window_end`, hard-gate results, ETA, useful
coverage minutes, total offered physician-hours, and conditional deficit reduction.
Code retains the canonical winning bundle and individually eligible beneficial
alternatives. An escalation action has no physicians and cannot create an offer.

If Jev selects escalation, `source="jev"` and `status="escalated"` preserve that
fact. When no hard-gated action exists, code escalates without spending a request.

## Native TypeSafe request and uncertainty

The single request is `POST https://api.typesafe.ai/v1/systemone` with a server-only
Bearer key and `{model, state, questions}`. Question `staffing_action` has type
`choice`; its criteria keys are the unique admitted action IDs. The normalized
answer contains the selected ID, full distribution, confidence, resolved model and
token usage. No application prompt-and-parse text generation is used.

State is allowlisted rather than copied from the operations report. It contains
policy/revision/cutoff, explicit units, gap measurements, counts of urgent operational
risks, candidate placeholders, relevant hard-gate flags, ETA and conditional
coverage projections. Names, physician/hospital IDs, consultation IDs, contact
channels, raw descriptions and clinical narratives are omitted. Action hashes are
opaque; the application maps them back to real immutable terms locally.

Response validation checks the exact requested question map and Choice type,
admitted selection, complete option set, finite probabilities in `[0,1]`, a sum near
one, highest-probability selection, finite confidence, consistency with the current
published Choice formula, resolved Jev model, and nonnegative integer usage. Parsing
is capped at 64 KiB. Invalid answers cannot introduce actions or weaken hard gates.

The initial confidence floor is **0.75**, configurable and provisional. Confidence
summarizes distribution concentration; it does not prove truth, safety, credentialing
or authorization. Validate this setting on organizer/judge records before adjusting
it. Low confidence keeps the deterministic recommendation and the actual returned
probabilities for review.

## Latency, failures and configuration

The deterministic fallback is ready before the provider request. The initial total
application deadline is **900 ms**, with no synchronous retry. Transport failure,
timeout, HTTP error, malformed response, uncertainty, disabled/missing credentials,
and open circuit are disclosed separately. The circuit opens after five consecutive
provider failures for 30 seconds; a valid response clears its failure count.
Uncertainty is a valid response, not a service outage. The circuit is process-local;
durable decision/audit history resides in the service database.

| Environment variable | Default |
| --- | --- |
| `TYPESAFE_API_KEY` | Required for live provider calls; no default key |
| `SEVARO_JEV_MODEL` | `jev-latest` |
| `SEVARO_JEV_DEADLINE_MS` | `900` (validated range 10–5000 ms) |
| `SEVARO_JEV_CONFIDENCE` | `0.75` |
| `SEVARO_JEV_FAILURE_LIMIT` | `5` |
| `SEVARO_JEV_CIRCUIT_SECONDS` | `30` |
| `SEVARO_JEV_MAX_ACTIONS` | `32`, including escalation (provider limit 255) |
| `SEVARO_JEV_ENABLED` | `true` |

The backend loader must populate its runtime environment from the ignored root
`.env` or deployment secret injection. This module reads the environment and never
reads, persists or returns a secret file. API keys are excluded from configuration
representations. Missing keys produce a disclosed fallback, not a simulated Jev result.

The deadline is a failure budget, not a measured provider-speed claim. Record
provider and end-to-end latency separately; local replay timings do not predict
network performance.

## Recorded ActionLab

```python
from backend.intelligence.actionlab import build_actionlab

comparison = build_actionlab(
    events, reference, cutoff, ledger=ledger, report=canonical_report,
    decision=stored_decision, run_id=run_id, revision=revision,
)
```

All five previews use the same imported event set, reference data, cutoff and ledger:
no action, deterministic routing, naive split-shift, scoped split-shift, and the
stored Jev-selected intervention. Jev is not called by read-only comparison requests.
Only a persisted decision matching run, revision and cutoff is replayed; otherwise
that comparison is unavailable. Its actual fallback/provider source remains visible.

Observed metrics include unique consultations with a receipt, open consultations,
recorded note sign-offs, counts of recorded physician work, and receipt-to-first-recorded
call/video timing. Contacts absent from the records are censored rather than invented.
These are shared evidence, not policy-specific outcome improvements. Note sign-off
is an operational event and does not establish patient treatment or outcome. A zero
count of supplied events does not establish zero actual work. An imported shift
start scopes the recorded count but does not certify completeness. Actual workload
remains unknown, and the challenge router's count-based workload proxy is identified
explicitly.

The split-shift trap demonstrates the difference between broad credential scope and
the narrow offered scope, alongside the challenge's recorded-count workload proxy.
It labels missing actual workload and conditional low-volume priority explicitly. It does
not make a physician online or create future assignments. Naive scope is an unsafe
comparison only and cannot be executed through the offer workflow.

Coverage estimates remain separately labeled conditional projections from supplied
baselines, schedules, ETA and disclosed capacity assumptions. Hospital-access
physician-minutes are not patient waiting time and cannot be summed across shared
credentials as independent network supply.

Patient-outcome improvement, policy-specific wait reduction and financial savings
remain `null` without supporting evidence. No response, consent, activation,
completion, patient or financial events are generated. The comparison hash binds
recorded events, source hashes, ledger, policy and selected persisted decision.
Replaying that saved decision is reproducible; a fresh live model request is not
promised to return the same judgment.

## Verification

```sh
python -m pytest backend/tests/test_intelligence.py -q
```

Tests use supplied organizer records and isolated provider fault injection. They
cover a native primary Choice, payload minimization, explicit escalation, eligibility
exclusion, invalid IDs/types/distributions/confidence/usage, uncertainty, bounded
timeout without retry, circuit recovery, stale revisions, missing credentials, and
reproducible recorded-only comparisons. API persistence, transaction races and
authorization are verified by service integration tests rather than duplicated here.
