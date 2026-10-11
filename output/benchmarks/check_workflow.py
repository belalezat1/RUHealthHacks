"""Six quick boundary/status checks in disposable application instances, not the live run."""
import json
import sys
import tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from fastapi.testclient import TestClient
from backend.api.main import create_app
from backend.tests.test_api import make_settings,User,full_loop_to_sent

cases=[]
def record(name,category,response,expected):
    cases.append({'case':name,'category':category,'expected_status':expected,'actual_status':response.status_code,
                  'passed':response.status_code==expected,'basis':'Actual FastAPI workflow in a disposable isolated test adapter; no live operational mutations'})
with tempfile.TemporaryDirectory(prefix='on-deck-quick-') as temp:
    app=create_app(make_settings(Path(temp)/'approval'))
    with TestClient(app):
        coord,lead=User(app,'coordinator'),User(app,'lead')
        proposed=coord.post('/api/v1/offers/propose',json={})
        assert proposed.status_code==200,proposed.text
        oid=proposed.json()['result']['offer_ids'][0]
        record('Coordinator cannot approve','Lead approval',coord.post(f'/api/v1/offers/{oid}/approve'),403)
        record('Cannot send without approval','Lead approval',coord.post(f'/api/v1/offers/{oid}/send'),409)
        record('Clinical lead can approve','Lead approval',lead.post(f'/api/v1/offers/{oid}/approve'),200)
        record('Approved simulated send works','Lead approval',coord.post(f'/api/v1/offers/{oid}/send'),200)
    for seconds,expected,label in [(599,200,'Accept at 9m59s'),(600,409,'Reject at exact 10m expiry')]:
        app=create_app(make_settings(Path(temp)/f'expiry-{seconds}'))
        with TestClient(app):
            coord,lead,physician=User(app,'coordinator'),User(app,'lead'),User(app,'phy-009')
            oid=full_loop_to_sent(coord,lead)
            advanced=coord.post('/api/v1/clock',json={'minutes':seconds/60})
            assert advanced.status_code==200,advanced.text
            record(label,'10m offer expiry',physician.post(f'/api/v1/offers/{oid}/accept'),expected)
p=Path(__file__).with_name('raw-results.json');result=json.loads(p.read_text());result['constraint_cases']+=cases
p.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(cases,indent=2))
assert all(c['passed'] for c in cases)
