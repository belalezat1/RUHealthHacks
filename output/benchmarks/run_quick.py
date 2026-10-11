"""Quick measurements only. Does not change application logic or active operational state."""
from __future__ import annotations
import asyncio
import csv
import io
import json
import os
import platform
import statistics
import sys
import time
from collections import Counter
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
import httpx

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from backend.api.config import load_settings
from backend.core.data import load_reference
from backend.core.events import read_csv_text, validate_batch
from backend.core.replay import replay
from backend.core.coverage import project_all
from backend.core.report import build_report
from backend.core.routing import route_order
from backend.core.staffing import EMPTY_LEDGER, evaluate_candidate
from backend.intelligence.decisions import DecisionEngine, DecisionConfig, build_actions, build_request

OUT = Path(__file__).resolve().parent
N = 25


def distribution(values):
    ordered = sorted(values)
    def quantile(q):
        at = (len(ordered) - 1) * q
        lo = int(at)
        hi = min(lo + 1, len(ordered) - 1)
        return ordered[lo] + (ordered[hi] - ordered[lo]) * (at - lo)
    return {'n':len(values), 'p50_ms':round(statistics.median(values),4), 'p95_ms':round(quantile(.95),4),
            'min_ms':round(min(values),4),'max_ms':round(max(values),4),'samples_ms':values}


def timed(function, count=N):
    for _ in range(3):
        function()
    values = []
    for _ in range(count):
        start = time.perf_counter()
        function()
        values.append((time.perf_counter()-start)*1000)
    return distribution(values)


def official():
    ref = load_reference()
    text = (ref.data_dir/'event_stream.csv').read_text()
    rows, errors = read_csv_text(text)
    assert not errors
    batch = validate_batch(rows, ref, {})
    assert batch.ok and len(batch.accepted)==1163
    return ref,text,rows,batch.accepted


def handbook_oracle(state, ref, hospital):
    """Independent routing oracle from handbook pp. 8–9; never calls route_order/availability.

    Replay state is the input, validated separately by the 208-field organizer oracle.
    Handbook leaves completely equal ties unspecified: accept any equally best physician.
    """
    eligible=[]
    reasons=Counter()
    markers=set()
    for pid,phy in ref.physicians.items():
        intervals=[]
        if phy.shift_start is not None and phy.shift_end is not None:
            intervals.append((phy.shift_start,phy.shift_end))
        if phy.next_shift_start is not None:
            # Same disclosed 12h schedule convention; cutoffs here never exceed 18:20.
            intervals.append((phy.next_shift_start,phy.next_shift_start+timedelta(hours=12)))
        if not any(start<=state.as_of<end for start,end in intervals):
            reasons['off_shift']+=1
            continue
        if hospital not in ref.credentials.get(pid,()):
            reasons['credentials']+=1
            continue
        p=state.physicians[pid]
        if p.conflicting_signals:
            reasons['unresolved_signals']+=1
            continue
        if p.active_calls or p.active_videos or (p.agent_online and p.camera_active and p.status!='In Meeting'):
            reasons['busy']+=1
            continue
        if p.status=='Temporarily Unavailable':
            reasons['unavailable']+=1
            continue
        if p.ringing_calls:
            reasons['ringing']+=1
            continue
        if p.last_call_ended_at is not None and state.as_of-p.last_call_ended_at<timedelta(seconds=120):
            reasons['cooldown']+=1
            continue
        count=len(p.consults_this_shift)
        low=count <= (4 if phy.role=='Night' else 6)
        key=(0 if low else 1,count,p.last_answered_at or datetime(1970,1,1,tzinfo=timezone.utc))
        eligible.append((pid,key))
        if not p.agent_online:
            markers.add('agent_offline_assumption')
    if reasons['credentials']: markers.add('credentials')
    if reasons['busy']: markers.add('busy')
    if reasons['cooldown']: markers.add('cooldown')
    if reasons['ringing']: markers.add('ringing')
    if not eligible:
        markers.add('no_eligible_physician')
        return [],set(),markers,dict(reasons)
    best=min(key for _,key in eligible)
    winners={pid for pid,key in eligible if key==best}
    if best[0]==0: markers.add('low_volume_priority')
    else: markers.add('above_threshold_fewest_consults')
    if len({key[1] for _,key in eligible})>1: markers.add('workload')
    same_count=[key for _,key in eligible if key[:2]==best[:2]]
    if len({key[2] for key in same_count})>1: markers.add('least_recent_answer_tiebreak')
    if len(winners)>1: markers.add('equal_tie_unspecified_by_handbook')
    return [pid for pid,_ in eligible],winners,markers,dict(reasons)


def selection_scenarios(ref,events):
    # Official recorded ingestion cutoffs, plus exact post-call cooldown boundaries.
    visible_times=sorted({e.ingested_at for e in events if e.ingested_at<=ref.scenario_now})
    times={visible_times[round(i*(len(visible_times)-1)/34)] for i in range(35)}
    times |= {ref.scenario_now,ref.scenario_now.replace(hour=13,minute=10,second=0)}
    ended=[e for e in events if e.event_type in ('incoming_call_ended','outgoing_call_ended')]
    for e in ended[-12:]:
        times.add(e.ingested_at)
        times.add(e.event_time+timedelta(minutes=2))
    candidates=[]
    for at in sorted(t for t in times if t<=ref.scenario_now):
        state=replay(events,ref,at)
        for hospital in sorted(ref.hospitals):
            eligible,winners,markers,reasons=handbook_oracle(state,ref,hospital)
            candidates.append((state,hospital,eligible,winners,markers,reasons))
    # Select category coverage first; use diversity, not the implementation's answer.
    categories=['cooldown','least_recent_answer_tiebreak','above_threshold_fewest_consults',
                'agent_offline_assumption','ringing','workload','equal_tie_unspecified_by_handbook',
                'low_volume_priority','busy','credentials','no_eligible_physician']
    chosen=[]
    used=set()
    for category in categories:
        available=[(i,c) for i,c in enumerate(candidates) if category in c[4] and i not in used]
        if available:
            i,c=available[len(available)//2]
            chosen.append(c);used.add(i)
    for i in [round(x*(len(candidates)-1)/24) for x in range(25)]+list(range(len(candidates))):
        if len(chosen)==25:break
        if i not in used:
            chosen.append(candidates[i]);used.add(i)
    cases=[]
    for index,(state,hospital,eligible,winners,markers,reasons) in enumerate(chosen,1):
        actual=route_order(state,ref,hospital,[])
        selected=actual[0]['physician_id'] if actual else None
        expected_correct=(selected in winners) if winners else selected is None
        admitted_correct=set(eligible)=={p['physician_id'] for p in actual}
        cases.append({'case':index,'cutoff':state.as_of.isoformat(),'hospital_id':hospital,
                      'expected_best_physicians':sorted(winners),'selected_physician':selected,
                      'expected_eligible':sorted(eligible),'actual_eligible':sorted(p['physician_id'] for p in actual),
                      'passed':expected_correct and admitted_correct,'categories':sorted(markers),'exclusions':reasons})
    coverage=Counter(category for case in cases for category in case['categories'])
    return {'n':len(cases),'passed':sum(case['passed'] for case in cases),'cases':cases,
            'category_coverage':dict(coverage),'missing_categories':[c for c in categories if not coverage[c]],
            'basis':'Handbook routing rules, independent oracle over actual replay state; equal unspecified ties accept any equally best physician. Not clinical accuracy.'}


def constraints(ref):
    cases=[]
    def check(label,category,pid,start,end,rule,expected):
        result=evaluate_candidate(ref,pid,frozenset({'SYN-005'}),start,end,EMPTY_LEDGER)
        actual=next(r for r in result['rules'] if r['rule']==rule)['passed']
        cases.append({'case':label,'category':category,'expected':expected,'actual':actual,'passed':actual==expected,
                      'start':start.isoformat(),'end':end.isoformat(),
                      'basis':'Hypothetical offer boundary using unchanged supplied roster; no source events or live offers created'})
    phy=ref.physicians['PHY-009']
    for minutes,expected in [(599,False),(600,True),(601,True)]:
        start=phy.last_shift_end+timedelta(minutes=minutes)
        check(f'Rest {minutes/60:.4g}h','10h rest','PHY-009',start,start+timedelta(hours=2),'rest',expected)
    for total,expected in [(59.5,True),(60,True),(60.5,False)]:
        check(f'Weekly total {total}h','60h weekly cap','PHY-009',ref.scenario_now,
              ref.scenario_now+timedelta(hours=total-phy.hours_worked_7d),'weekly_hours',expected)
    next_shift=ref.physicians['PHY-011'].next_shift_start
    for start,end,expected,label in [(next_shift-timedelta(hours=2),next_shift,True,'Ends at shift start'),
              (next_shift-timedelta(hours=2)+timedelta(minutes=1),next_shift+timedelta(minutes=1),False,'Overlaps by one minute'),
              (ref.scenario_now,ref.scenario_now+timedelta(hours=2),False,'Original conflicting candidate')]:
        check(label,'Shift overlap','PHY-011',start,end,'no_schedule_overlap',expected)
    return cases


def base():
    load_settings()  # Server-side .env only; no key is read by the frontend.
    ref,text,rows,events=official()
    state=replay(events,ref,ref.scenario_now)
    report=build_report(events,ref,ref.scenario_now)
    assert report['verification']['matched']==208
    hospital=iter(list(ref.hospitals)*100)
    speed={'Routing (one hospital)':timed(lambda:route_order(state,ref,next(hospital),[])),
           'Parse, dedupe + event replay':timed(lambda:replay(validate_batch(read_csv_text(text)[0],ref,{}).accepted,ref,ref.scenario_now)),
           'Forecast (12 hospitals / 90 min)':timed(lambda:project_all(state,ref,[])),
           'Full load + analysis + JSON':timed(lambda:json.dumps(build_report(validate_batch(read_csv_text(text)[0],ref,{}).accepted,load_reference(),ref.scenario_now)))}
    scaled=[]
    for factor in (1,5,10):
        buf=io.StringIO();writer=csv.DictWriter(buf,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows*factor)
        scaled_text=buf.getvalue()
        def run_scaled():
            batch=validate_batch(read_csv_text(scaled_text)[0],ref,{})
            assert len(batch.accepted)==1163
            json.dumps(build_report(batch.accepted,ref,ref.scenario_now))
        scaled.append({'factor':factor,'input_rows':len(rows)*factor,'unique_events':1163,
                       'duplicates':len(rows)*factor-1163,'measurement':timed(run_scaled)})
    api={}
    accounts=json.loads((ROOT/'.local/browser-accounts.json').read_text())
    account=next(a for a in accounts if a['role']=='coordinator')
    with httpx.Client(base_url='http://127.0.0.1:8000',timeout=10) as client:
        client.post('/api/v1/session',json={'username':account['username'],'password':account['password']}).raise_for_status()
        for route in ('state','report','actionlab'):
            def read():
                response=client.get('/api/v1/'+route);response.raise_for_status()
            api[route]=timed(read)
        current=client.get('/api/v1/report').json()['data']
    speed['HTTP API report (warm)']=api['report']
    by_id={c['physician_id']:c for c in report['staffing']['candidates']}
    expected={'PHY-009':True,'PHY-010':False,'PHY-011':False,'PHY-012':False,'PHY-013':False,'PHY-014':False}
    roster_checks=[{'physician_id':pid,'expected_eligible':value,'actual_eligible':by_id[pid]['eligible'],
                    'passed':value==by_id[pid]['eligible']} for pid,value in expected.items()]
    results={'measured_at':datetime.now(timezone.utc).isoformat(),'release_sha':__import__('subprocess').check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
             'machine':{'platform':platform.platform(),'python':platform.python_version(),'cpus':os.cpu_count()},
             'dataset':{'source_hashes':ref.source_hashes,'raw_rows':len(rows),'unique_events':len(events),'physicians':len(ref.physicians),'hospitals':len(ref.hospitals),'reference_match':'208/208'},
             'runs_per_measurement':N,'speed':speed,'api':api,'api_state':{'revision':current['run']['revision'],'event_count':current['counts']['events_applied'],'offer_count':len(current['offers'])},
             'selection':selection_scenarios(ref,events),'off_shift_roster_checks':roster_checks,'constraint_cases':constraints(ref),
             'scalability':{'kind':'duplicate-heavy unchanged-record replay stress; unique-event growth untested','points':scaled},
             'coverage':{'hospital_id':report['staffing']['target']['hospital_id'],'hospital_name':report['staffing']['target']['hospital_name'],
               'before_deficit_physician_minutes':report['staffing']['baseline_deficit_minutes'],
               'after_conditional_deficit_physician_minutes':report['staffing']['projected_deficit_minutes'],
               'selected_physicians':report['staffing']['selected'],'kind':'Modeled conditional 90-minute hospital-access shortfall. No online activation or observed outcome improvement generated.'},
             'limits':['Official dataset only; no new unique operational facts generated','Selection oracle reuses replay state, independently verified by the 208-field reference; it is independent of routing output, not a clinical label set','Runtime API reads are warm-cache localhost PostgreSQL reads at current persisted official-data run','Boundary offer tests are isolated hypothetical proposals, not observed scheduling outcomes','Timing samples are local serial runs; no production SLA or maximum-throughput claim']}
    (OUT/'raw-results.json').write_text(json.dumps(results,indent=2)+'\n')
    # Prove the exact outbound structure is anonymous before any live call.
    actions,_=build_actions(report,run_id='quick-benchmark-official',revision=1)
    payload=json.dumps(build_request(report,actions,model='jev-latest',revision=1))
    forbidden=[p.name for p in ref.physicians.values()]+[h.name for h in ref.hospitals.values()]+list(ref.physicians)+list(ref.hospitals)
    assert not any(value in payload for value in forbidden)
    assert not any(e.consult_id and e.consult_id in payload for e in events)
    proof={'outbound_endpoint':'https://api.typesafe.ai/v1/systemone','maximum_live_requests':N,'request_bytes':len(payload.encode()),
           'contains_names_or_source_ids':False,'contains_raw_clinical_narratives':False,'contains_credentials':False,
           'source':'Unchanged organizer challenge records; only anonymous allowlisted operational features sent','credential_handling':'Ignored root .env, HTTPS Authorization header only; no request/response body or key saved'}
    (OUT/'jev-payload-proof.json').write_text(json.dumps(proof,indent=2)+'\n')
    print(json.dumps({'speed':{k:{'p50_ms':v['p50_ms'],'p95_ms':v['p95_ms']} for k,v in speed.items()},'selection_passed':results['selection']['passed'],'selection_n':results['selection']['n'],'categories':results['selection']['category_coverage'],'missing':results['selection']['missing_categories'],'constraint_passed':sum(c['passed'] for c in results['constraint_cases'])},indent=2))


async def live():
    load_settings()
    ref,text,rows,events=official();report=build_report(events,ref,ref.scenario_now)
    default=DecisionConfig.from_env()
    baseline=DecisionEngine(replace(default,enabled=False))
    live_engine=DecisionEngine(default)
    raw=[]
    baseline_times=[]
    try:
        for i in range(N):
            start=time.perf_counter();det=await baseline.select(report,run_id='quick-benchmark-official',revision=1)
            baseline_times.append((time.perf_counter()-start)*1000)
            start=time.perf_counter();decision=await live_engine.select(report,run_id='quick-benchmark-official',revision=1)
            elapsed=(time.perf_counter()-start)*1000
            raw.append({'run':i+1,'elapsed_ms':elapsed,'source':decision['source'],'status':decision['status'],
                        'provider_status':decision['provider']['status'],'provider_latency_ms':decision['provider']['latency_ms'],
                        'model':decision['model'],'confidence':decision['confidence'],'fallback_reason':decision['fallback_reason'],
                        'selected_physicians':decision['selected_physician_ids'], 'baseline_physicians':det['selected_physician_ids'],
                        'agrees_with_deterministic':decision['selected_action_id']==det['selected_action_id']})
    finally:
        await baseline.aclose();await live_engine.aclose()
    provider_attempts=[r['elapsed_ms'] for r in raw if r['provider_status'] not in {'disabled','not_requested','circuit_open'} and r['fallback_reason']!='missing_api_key']
    genuine=[r for r in raw if r['source']=='jev']
    result={'deterministic_selector':distribution(baseline_times),'live_runs':raw,'live_attempt_latency':distribution(provider_attempts) if provider_attempts else None,
            'actual_jev_latency':distribution([r['elapsed_ms'] for r in genuine]) if genuine else None,
            'requested_runs':N,'actual_jev_selections':len(genuine),'provider_status_counts':dict(Counter(r['provider_status'] for r in raw)),
            'jev_agreement':{'matched':sum(r['agrees_with_deterministic'] for r in genuine),'n':len(genuine)},
            'comparison_scope':'Repeated one official staffing state: one feasible physician plus escalation, not diverse Jev accuracy evaluation',
            'deadline_ms':default.deadline_ms,'contains_raw_request_response_or_credentials':False}
    (OUT/'jev-results.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k!='live_runs'},indent=2))


if __name__=='__main__':
    if '--jev' in sys.argv:
        asyncio.run(live())
    else:
        base()
