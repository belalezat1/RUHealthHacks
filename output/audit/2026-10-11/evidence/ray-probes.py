import json,time,uuid,csv,statistics
from copy import deepcopy
from datetime import datetime,timezone,timedelta
import httpx
base='http://127.0.0.1:58439'
c=httpx.Client(base_url=base,headers={'X-Demo-Role':'dispatcher','X-Demo-Actor':'audit-dispatcher'},timeout=10)
def post(path,body,headers=None): return c.post(path,json=body,headers={'Idempotency-Key':str(uuid.uuid4()),**(headers or {})})
results={}
examples=c.get('/v1/datasets/examples').json()
d=examples[0]['dataset'];d['dataset_id']='audit-probe-'+uuid.uuid4().hex[:8]
results['import']=post('/v1/datasets/import',d).status_code
snap=c.get('/v1/dashboard').json()
props=[]
for consult in snap['consultations']:
 if consult['status']=='waiting':
  p=post('/v1/optimizations/preview',{'consultation_id':consult['id']})
  if p.status_code==200:props.append(p.json());break
p=props[0];rid=p['id'];pid=p['candidate']['physician_id'];cid=p['candidate']['consultation_id']
results['chosen_candidate']={'physician_id':pid,'action':p['candidate']['action'],'duration_minutes':(datetime.fromisoformat(p['candidate']['end_at'])-datetime.fromisoformat(p['candidate']['start_at'])).total_seconds()/60}
p2=post('/v1/optimizations/preview',{'consultation_id':cid}).json()
results['two_open_proposals_same_physician']={'same_physician':p2['candidate']['physician_id']==pid,'first_status':p['status'],'second_status':p2['status']}
results['dispatcher_approve_status']=post('/v1/recommendations/'+rid+'/approve',{'reason':'Audit role check'}).status_code
results['no_auth_dashboard']=c.get('/v1/dashboard',headers={'X-Demo-Role':'','X-Demo-Actor':''}).status_code
results['wrong_physician_accept']=post('/v1/recommendations/'+rid+'/physician-response',{'accepted':True},headers={'X-Demo-Role':'physician','X-Demo-Actor':'wrong'}).status_code
rows=list(csv.DictReader(open('/tmp/sevaro-audit-20261011/backend/backend/data/event_stream.csv')))
results['official_event_rejected']=post('/v1/events',rows[0]).status_code
results['official_dataset_rejected']=post('/v1/datasets/validate',{'events':rows[:3]}).json()['valid']
e={'dataset_id':d['dataset_id'],'source':'synthetic_console','event_id':'audit-wrong-heartbeat','event_type':'availability','entity_id':pid,'observed_at':datetime.now(timezone.utc).isoformat(),'payload':{'kind':'heartbeat','value':'available'}}
results['invalid_signal_pair_status']=post('/v1/events',e).status_code
# Opposite arrivals of equal-time conflicting signals under the same source.
out=[]
for order in [('connected','disconnected'),('disconnected','connected')]:
 dd=deepcopy(examples[0]['dataset']);dd['dataset_id']='audit-tie-'+uuid.uuid4().hex[:8]
 post('/v1/datasets/import',dd)
 at=datetime.now(timezone.utc).isoformat(); responses=[]
 for val in order:
  ev={'dataset_id':dd['dataset_id'],'source':'synthetic_console','event_id':'audit-'+val,'event_type':'availability','entity_id':pid,'observed_at':at,'payload':{'kind':'heartbeat','value':val}}
  responses.append(post('/v1/events',ev).json())
 av=next(x['availability'] for x in c.get('/v1/dashboard').json()['physicians'] if x['id']==pid)
 out.append({'order':order,'responses':responses,'status':av['status'],'connected':av['connected'],'conflicts':av['conflicts']})
results['equal_time_conflict_orders']=out
lat=[]
for _ in range(25):
 st=time.perf_counter();r=c.get('/v1/dashboard');lat.append((time.perf_counter()-st)*1000);assert r.status_code==200
results['dashboard_25_serial_ms']={'p50':statistics.median(lat),'p95':sorted(lat)[23],'max':max(lat)}
print(json.dumps(results,indent=2));open('/tmp/sevaro-audit-20261011/ray-probes.json','w').write(json.dumps(results,indent=2))
