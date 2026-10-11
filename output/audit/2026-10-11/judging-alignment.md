# Challenge 2 judging and specification alignment

Reviewed October 11, 2026, against the supplied five-criterion rubric, Challenge 2 Handbook chapters 1–7, the official v2 challenge brief, current local source references, the previous engineering audit, and the proposed integration plan.

## Verdict and evidence boundary

**The proposed product fits the challenge, but the current integrated submission is not ready to claim full compliance.** Local `belal` remains at `fb87fbd88080262f92963352d7f3f2889d2982ec` and contains planning documents rather than an executable application. Working source-branch components must be integrated and demonstrated together.

Source references checked:

- Yassin: `29f0b6042f6ac86553c3d45edea22bb3926ff713`.
- Ray: `ae6bdff862a57507b73d0a73e4d1a21112369fc6`.
- Frontend: `8806f782a602521e601b7ddc4196887f378027c3`, newer than the frontend covered by the original audit.

Yassin's unchanged source was rerun in the isolated audit environment: **29 tests passed in 2.92 seconds**, with one dependency deprecation warning. A separate official-data report invocation confirmed 1,164 input rows, 1,163 unique events, duplicate `EVT-00529`, **208/208 snapshot fields**, a **90-minute horizon**, six off-shift evaluations, target `SYN-005`, and selected physician `PHY-009`. These are source-engine results, not evidence that the selected frontend or `belal` implements them.

Previously reproduced defects remain supported by unchanged source and the preserved audit probes. Ray's earlier test results are historical audit evidence; they were not rerun for this review. The updated frontend was inspected statically, not given a new browser certification.

## Five rubric criteria

| Criterion | Alignment | Evidence needed for a strong submission |
|---|---|---|
| Innovation & Creativity | Good concept alignment; novelty is not independently established | Demonstrate the decision/action loop beyond Sevaro's existing live display: explain the top problem, choose a feasible intervention, enforce approval, scope the joiner, and audit the result. Explain Jev's bounded selection and actual fallback behavior. Adding AI alone does not establish differentiation. |
| Technical Implementation | Partial across source branches; incomplete on `belal` | One official-CSV backend, connected frontend, durable transitions, atomic live imports, correct policies, and end-to-end tests. Existing passing component tests do not prove integrated operation. |
| Healthcare Impact | Direct alignment with the operational problem | Show delayed stroke consults, credential-specific shortages, upcoming shift losses, and an actionable response. Report operational waits and coverage measures with their definitions. Do not claim reduced mortality, patient outcomes, or financial savings without evidence. |
| Presentation & Demonstration | Requires an integrated rehearsal | Coordinator identifies the first problem; clinical lead sees evidence and approves; physician uses a restricted stand-in phone screen; judges inject their CSV without restart; the system updates and explains the next action. Polished visuals cannot substitute for this flow. |
| Feasibility & Scalability | Credible planned architecture; not yet demonstrated | Reproducible startup, persistence/recovery, concurrency protection, bounded Jev latency, measured load results, and an honest Sevaro integration boundary. Production licensing, identity, and institutional integration remain separate evidence requirements. Live AWS deployment is not a stated handbook requirement. |

No numeric judge score is assigned. Innovation, impact, and presentation depend on demonstrated behavior and the judges' assessment; awarding 5/5 from a plan would be unsupported.

## Eight required demonstrations

| Handbook requirement | Current evidence | Integration acceptance condition |
|---|---|---|
| 1. Rebuild 18:20 and match the snapshots | Yassin verified 208/208 | Preserve the oracle after porting; replay events rather than using reference snapshots to manufacture state. |
| 2. Separate physician activity and consult lifecycle; display elapsed limits | Yassin implementation and tests | Render independent physician/consult state and the exact warning/critical thresholds below. |
| 3. Rank problems and explain each flag | Yassin report; integrated UI absent | Every problem exposes what, where, elapsed time/threshold, why it matters, suggested fix, alternatives, and approving role. |
| 4. Forecast at least 90 minutes | Yassin report verified 90 minutes | Include shift ends/starts, hospital-specific hourly baselines, credentials, and surge uplift; distinguish projected, assumed, planned, and confirmed capacity. |
| 5. Recommend a fix; explain all off-shift candidates | Six candidates and selected `PHY-009` verified for the original state | Evaluate every off-shift physician against the current target; show every rule's pass/fail/unknown result and escalate if none qualify. Never hard-code the sample winner. |
| 6. Propose → approve → pretend-send → accept/decline → update | Yassin API tests pass; selected UI still uses local demo state | One durable server-owned workflow, lead approval before send, restricted physician responses, expiry/no-reply handling, planned coverage update, and no duplicate outreach once commitments cover the gap. |
| 7. Prevent a zero-count joiner from being swamped | Yassin hospital scoping exists; joined workload/availability handling is defective | Enforce approved hospital scope and update actual counts, last-answer time, busy/ringing/cooldown state. Demonstrate routing restrictions without generating future clinical events. |
| 8. Add judges' CSV without restart | Yassin import test passes; selected UI lacks real ingestion | Append same-eight-column records to the existing run, rebuild state, refresh risks/forecast/recommendations automatically, and keep the running application alive. |

The concrete judge injection uses the same physicians, hospitals, event kinds, and day. Its new events move the scenario forward. The application must use explicit scenario time and make newly imported events visible; updating the database while leaving the report clock at 18:20 would not satisfy the live test. Generalized roster/date loading is useful, but does not replace this narrower required demonstration.

## Exact challenge rules to preserve

### Stage warnings and critical limits

| Stage / condition | Applies to | Warning | Critical |
|---|---|---|---|
| Triaged, unassigned | All | 5 min | 10 min |
| Assigned, no provider contact | Stroke | 3 min | 8 min |
| Imaging pending | Stroke | 12 min | 20 min |
| Imaging returned, video not started | Stroke | 6 min | 12 min |
| Note pending or documentation, measured from clinical call/video end | Stroke | 30 min | 45 min |
| Same documentation clock | General Neuro | 45 min | 90 min |
| Unfinished notes within 60 minutes of shift end | All | Any | 2 or more |

Starting note-writing must not reset the documentation clock. Do not invent a threshold for an unspecified stage or treat every stroke label as an independently supplied STAT field.

### Availability, routing, coverage, and offers

- Active Synapse call/video means busy. Camera activity without a Synapse video and without `In Meeting` means probable external-video busy, with a flag. An internal meeting is interruptible when no overriding active call/video makes the physician busy.
- Agent-offline routing is **assumed available but unverified under challenge rules**. Preserve that distinction in challenge predictions. It must never become confirmed capacity or a production availability pass. A blanket exclusion would change the documented challenge router.
- Routing requires on-shift hospital credentials, excludes busy/ringing and call-end cooldown under two minutes, gives low-volume priority at day ≤6/night ≤4 consults, then fewest consults and least-recent answer. No eligible physician means failure with a five-minute retry interval; display/model this without inventing observed retry events.
- A hospital surge means unique arrivals in the trailing 60 minutes exceed that hospital/hour's p90 baseline. Required available credentialed headcount is the time-block minimum **plus one** during a surge. Keep this headcount measure separate from work-minute allocation and never sum overlapping physician access as independent network supply.
- Split shifts require opt-in, credentials at a gap hospital, rest ≥10 hours at offered start, trailing seven-day work plus proposed commitment ≤60 hours, no schedule/commitment clash, and offered duration ≥2 hours. Display ETA and net useful coverage. Chapter 2's example suggests rejecting poor-value short coverage; Chapter 5 and the v2 brief explicitly set the two-hour minimum on offer duration. Preserve the explicit gate and disclose reduced useful coverage rather than silently claiming two hours online.
- One outstanding offer per physician; at most three offers per week; ten-minute expiry after send; lead approval before outreach; private physician-specific replies; transactional competing acceptances; immutable terms and full candidate/approval/outcome audit.
- Notification payloads must exclude patient and consult details. Use a whitelist of hospital names, offered hours/start/end; keep clinical evidence and patient identifiers in the authorized internal view.
- Reserve a gap when accepted commitments cover its planned requirement and suppress further outreach. Keep actual confirmed coverage separate. Release/revalidate reservations after cancellation, invalidation, or changed demand; unresolved actual capacity remains visible.

## Blocking defects and plan additions

1. **P0 — No integrated executable submission on `belal`.** Import and connect the selected components; verify the full flow rather than treating branch availability as completion.
2. **P0 — Repeat receipt defect.** Yassin preserves one consult object but overwrites original receipt time and counts repeated receipts as demand. Fix earliest receipt, one arrival, and retained retry evidence.
3. **P0 — Accepted-work accounting.** Static roster hours/rest omit subsequent accepted work. The prior 58 + 2 + 2-hour counterexample incorrectly passes. Reconcile commitments and observed intervals and revalidate transactionally.
4. **P0 — Frontend data ownership.** Latest frontend still reads `useDemo`. Its economics module defines fabricated rates, experience, and a 1.25 premium, including a zero default for absent rates. Replace active mock state and remove unsupported money/quality displays.
5. **P1 — Joined physician routing.** Current joiner branch resets workload to zero and bypasses live busy/ringing/cooldown checks after ETA. Scope alone does not resolve overload.
6. **P1 — Request and evidence integrity.** Fix changed-payload idempotency, equal-time contradictory availability, and accepted/ETA-only false confirmation.
7. **P1 — Make the plan's demonstration contract explicit.** Add exact stage thresholds, p90 +1 headcount math, all-candidate explanations, safe notification whitelist, planned-gap reservation/outreach suppression, scenario-clock behavior after import, and a stand-in physician phone flow to integration acceptance checks.

The previous plan already covers most of these directions, but its higher-level policy language must not permit the exact challenge rules to be replaced by Ray's custom domain rules or generic production defaults.

## Data, finance, and optional work

The handbook explicitly uses made-up hackathon records and prohibits real patient, physician, or hospital data in the challenge. The user's clarified constraint is compatible: consume supplied organizer/judge records, preserve their provenance, and invent no additional runtime facts.

Cost, licensing integration, fatigue/fairness extensions, alert overload, and stale-data handling are listed as possible extensions, not substitutes for the required Detect–Decide–Act loop. No supplied financial variables support HB/PB, reimbursement, compensation, or profit claims. Keep financial optimization unavailable. Real financial/clinical integration belongs in a separate authorized production boundary, not in the challenge fixture.

Recorded ActionLab replay and recommendation comparison are compatible with the handbook. Multi-policy generated future outcomes are not required. Without observed online evidence, show the accepted commitment's projected benefit and pending confirmation; do not manufacture activation to finish the demo. New judge events may provide additional usable activity evidence, but their contents cannot be assumed in advance.

## Judging rehearsal acceptance

1. Start one backend/frontend against the organizer bundle at 18:20 ET; show snapshot verification and the ranked first problem.
2. Explain the 90-minute hospital forecast, p90 surge uplift, credentials, and impending shift changes.
3. Show all six off-shift candidates and rule-derived results. Allow current data to determine the recommendation.
4. Complete coordinator proposal, lead approval, pretend-send, and restricted physician acceptance/decline. Show audit history and planned capacity; reload to prove persistence.
5. Show approved hospital scope, routing targets, and current workload/activity exclusion. Label any policy preview as a recommendation, not a future observed outcome.
6. Inject the judge CSV into the same live run. Show accepted/duplicate/conflict counts, updated scenario time, revised risks and intervention, without a restart or manual edits to displayed facts.
7. Demonstrate no eligible candidate → escalation, Jev timeout → disclosed fallback, late reply → clean expiry response, and a competing acceptance → one valid claim.
8. Present measured latency, recovery/concurrency evidence, and a concise integration boundary. Claims about benefits remain limited to measured operational behavior.

## Reproduction used in this review

```sh
cd /tmp/sevaro-audit-20261011/yassin
/tmp/sevaro-audit-20261011/yassin-venv/bin/python -m pytest -q backend/tests
```

Official-data report verification used `load_reference`, `read_csv_text`, `validate_batch`, and `build_report` at `SCENARIO_NOW`, separately from the test runner. Source inspection covered Yassin's events/replay/risks/coverage/routing/staffing, its API tests, and the latest frontend's active app/demo economics.

No application code, source branches, credentials, or cloud resources were changed. This document is a compliance review and acceptance checklist; it is not an implementation-completion report.
