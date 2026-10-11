import csv
import dataclasses
import json
import shutil
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from fastapi.testclient import TestClient
from backend.api.main import create_app
from backend.core.coverage import Commitment
from backend.core.data import DEFAULT_DATA_DIR, ET, load_reference
from backend.core.events import event_from_row, _validate_event
from backend.core.staffing import OfferLedgerView, evaluate_candidate
from backend.core.replay import replay
from backend.tests.test_api import make_settings, User

result = {}
dest = Path(tempfile.mkdtemp(prefix='sevaro-renamed-', dir='/tmp/sevaro-audit-20261011'))
shutil.copytree(DEFAULT_DATA_DIR, dest, dirs_exist_ok=True)
for p in dest.glob('*.csv'):
    p.write_text(p.read_text().replace('SYN-', 'HOSP-'))
ref = load_reference(dest)
result['renamed_same_schema_hospitals'] = {'hospitals': len(ref.hospitals), 'credential_edges': sum(len(x) for x in ref.credentials.values())}
ref = load_reference()
phy = dataclasses.replace(ref.physicians['PHY-009'], hours_worked_7d=58)
ref = dataclasses.replace(ref, physicians={**ref.physicians, phy.id: phy})
start = datetime(2026,3,17,23,0,tzinfo=ET)
accepted = Commitment(phy.id, frozenset({'SYN-005'}), start-timedelta(hours=4), start-timedelta(hours=2), start-timedelta(hours=4))
ledger = OfferLedgerView(frozenset(), (accepted,), {})
candidate = evaluate_candidate(ref, phy.id, frozenset({'SYN-005'}), start, start+timedelta(hours=2), ledger)
result['accepted_work_omitted_from_hours_and_rest'] = {'eligible': candidate['eligible'], 'actual_total_hours': 62, 'actual_rest_hours': 2, 'reported_checks': [r for r in candidate['rules'] if r['rule'] in ('rest', 'weekly_hours', 'no_accepted_overlap')]}
row = {'event_id':'audit-future','event_time':'2026-03-18T18:21:00-04:00','ingested_at':'2026-03-18T18:21:02-04:00','consult_id':'CON-AUDIT','event_type':'consult_received','physician_id':'','hospital_id':'SYN-005','description':'Stroke consult request received'}
result['new_day_same_schema'] = _validate_event(event_from_row(row), ref)
repeat_rows = []
for i, t in enumerate(('18:05', '18:12')):
    repeat_rows.append(event_from_row({**row, 'event_id':f'audit-repeat-{i}', 'event_time':f'2026-03-17T{t}:00-04:00', 'ingested_at':f'2026-03-17T{t}:02-04:00'}))
state = replay(repeat_rows, ref, datetime(2026,3,17,18,20,tzinfo=ET))
c = state.consults['CON-AUDIT']
result['repeat_call_same_consult'] = {'consult_count':len(state.consults),'received_demand_count':len(state.received_times['SYN-005']),'received_at':c.received_at.isoformat(),'elapsed_minutes':(state.as_of-c.received_at).total_seconds()/60,'expected_first_received_minutes':15}
state_dir = Path(tempfile.mkdtemp(prefix='sevaro-idem-', dir='/tmp/sevaro-audit-20261011'))
app = create_app(make_settings(state_dir))
with TestClient(app):
    user = User(app, 'coordinator')
    first = user.post('/api/v1/clock', json={'minutes':1}, key='payload-change')
    second = user.post('/api/v1/clock', json={'minutes':30}, key='payload-change')
    result['changed_payload_same_idempotency_key'] = {'first_status':first.status_code,'second_status':second.status_code,'second_replayed':second.json().get('idempotent_replay'),'clock':user.state()['as_of']}
Path('/tmp/sevaro-audit-20261011/yassin-probes.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
