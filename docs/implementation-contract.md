# Implementation contracts

The attached implementation instructions take precedence over BUILD-PLAN.md. Local-first modular monolith, synthetic data only.

## Domain state (plain dictionaries; UTC ISO strings)
`state = {dataset_id, source_version, hospitals: [], physicians: [], credentials: [], shifts: [], signals: [], consultations: [], assignments: []}`.
Hospital: `id,name,jurisdiction,timezone,specialty,minimum_coverage` (0 default), `arrival_work_minutes_per_bin` (0 default).
Physician: `id,name,specialties: string[],max_concurrent: int,metadata: {}`.
Credential: `id,physician_id,kind: license|privilege,jurisdiction?,hospital_id?,expires_at`.
Shift: `id,physician_id,hospital_id,start_at,end_at,status: scheduled|cancelled,mandatory: bool`.
Signal: `id,physician_id,source,kind: heartbeat|self_report|activity|activation,value: connected|disconnected|available|unavailable|busy|active,observed_at,received_at,source_sequence?`.
Consultation: `id,hospital_id,specialty,priority: urgent|routine,requested_at,deadline_at,duration_minutes,status: waiting|assigned|active|completed,physician_id?`.
Assignment: `id,consultation_id,physician_id,hospital_id,start_at,end_at,status: assigned|verified|completed, recommendation_id?`.

`config/demo_policies.json` defines demo assumptions. Pure domain functions take `(state, ..., now: datetime, policy: dict)`; no ORM dependency. Parse ISO dates with helper, return JSON-serializable objects.

## Backend domain service interfaces
- availability.reconcile(state, physician_id, now, policy) -> `{status, connected, stale, conflicts: [], workload, on_shift, signals: []}`
- eligibility.evaluate(state, physician_id, hospital_id, consultation_id, action, now, policy, consent=False, start_at=None, end_at=None) -> `{physician_id,outcome: eligible|ineligible|unverified,action,rules:[{code,status: pass|fail|unknown,observed,required,source,observed_at,explanation}]}`. Contact permits off-shift availability and defers consent; assignment requires shift or consent, current connectivity, no busy signal/workload.
- forecast.build_forecast(state, now, policy) -> `{intervals:[{start_at,end_at,demand_minutes,capacity_minutes,unmet_minutes,hospitals:[{hospital_id,demand_minutes,capacity_minutes,unmet_minutes,severity,reason}]}],risks:[],assumptions:[],as_of,valid_until}`.
- optimizer.preview(state, consultation_id, now, policy, method='greedy') -> `{selected: candidate|null,alternatives:[],rejected:[],solver:{...},assumptions:[]}`. Candidate `{physician_id,consultation_id,hospital_id,action: route|activate,start_at,end_at,score,eligibility,expected_effect,explanation}`. `contact` eligibility for activation; no mutation.
- simulation.replay.run_simulation(state, scenario, seed, now, policy) -> `{baseline:{...metrics},optimized:{...metrics},trace:[],metadata:{...}}` same domain functions isolated deepcopy.

## API frontend contract
All APIs under /v1 (except /health,/ready). Demo actor headers: `X-Demo-Role: dispatcher|admin|physician|evaluator`, `X-Demo-Actor: demo-dispatcher` and physician actor is exact physician ID. Optional `X-Demo-Hospitals` comma scope. Default client dispatcher. Header-based demo actors only accepted APP_ENV=local/test, AUTH_MODE=demo. Every mutation uses `Idempotency-Key` where relevant.
GET /dashboard -> `{dataset_id,source_version,as_of,valid_until,synthetic:true,counts:{physicians,consultations,waiting,assigned,at_risk_hospitals,pending_interventions},physicians:[...physician,availability],consultations:[],hospitals:[],forecast:{...},recommendations:[],jev:{mode,status,model},freshness:{stale,conflicts}}`.
GET /physicians -> physician array with availability and credentials/shifts. GET /consultations -> array. GET /coverage/forecast -> forecast. GET /risks -> array. GET /physicians/{id}/eligibility?hospital_id=&consultation_id=&action=contact|assign.
POST /datasets/validate body raw dataset -> `{valid,errors:[{path,field,reason}],counts}`. POST /datasets/import same -> `{dataset_id,source_version,duplicate}`. Additional GET /datasets/examples returns `{id,label,dataset}` list dynamically timestamp-rebased for local demo. Fixture schema `schema_version: synthetic_v1,dataset_id,label,synthetic:true,as_of,hospitals,physicians,credentials,shifts,signals,consultations`.
POST /events body `{dataset_id,source,event_id,event_type,entity_id,observed_at,source_sequence?,payload}`. Types `availability` (payload kind,value), `consultation.created` (whole consultation), `consultation.completed` ({}), `activation` (payload recommendation_id optional). -> `{event_id,outcome:applied|duplicate|late,source_version}`. POST /events/batch `{events:[]}` atomic. GET /events?offset=&limit= -> `{items,total}`.
POST /optimizations/preview `{consultation_id,method?:greedy|baseline|cp_sat}` -> recommendation `{id,status,workflow_version,source_version,expires_at,candidate,alternatives,rejected,solver,assumptions,advisory}` (no candidate -> 422).
GET /recommendations/{id} -> same. POST /recommendations/{id}/approve or /reject `{reason}`. POST /physician-response `{accepted:boolean,reason}` with physician actor. POST /commit `{reason}`. POST /verify `{reason}`. Each -> updated recommendation. Status lifecycle proposed -> approved_for_contact -> physician_accepted -> assigned -> verified. Rejection/decline terminal. Consent always explicit demo.
GET /audit?offset=&limit= -> `{items:[{id,actor,role,action,entity_id,before,after,reason,created_at}],total}`.
POST /simulations `{scenario,seed:42}` -> `{id,...run result}`. GET /simulations/{id}. GET /simulations/scenarios -> array `{id,label,description}`. Frontend JSON metrics export is client-side. GET /simulations/{id}/export returns stored JSON.
Errors use `{detail: string|validation details}` HTTP 409 for stale/conflict.
