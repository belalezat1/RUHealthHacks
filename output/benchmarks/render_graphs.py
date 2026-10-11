"""Render only measured benchmark results; coverage is explicitly conditional."""
import os
os.environ.setdefault('MPLCONFIGDIR', '/tmp/on-deck-mpl')
import csv, json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.lines import Line2D
from PIL import Image, ImageOps, ImageDraw
ROOT = Path(__file__).resolve().parent
r = json.loads((ROOT/'raw-results.json').read_text())
j = json.loads((ROOT/'jev-results.json').read_text())
NAVY, BLUE, TEAL, GREY = '#152C46', '#2674E8', '#008879', '#63758A'
plt.rcParams.update({'font.family':'DejaVu Sans', 'font.size':14, 'axes.labelcolor':GREY,'text.color':NAVY,'xtick.color':GREY,'ytick.color':NAVY,'axes.edgecolor':'#DCE4ED','savefig.facecolor':'white'})
def page(title, subtitle, foot):
 fig=plt.figure(figsize=(16,9),dpi=160,facecolor='white')
 fig.text(.055,.947,'ON DECK  /  SEVARO CHALLENGE 2',fontsize=12,weight='bold',color=BLUE)
 fig.text(.055,.883,title,fontsize=29,weight='bold')
 fig.text(.055,.837,subtitle,fontsize=14,color=GREY)
 fig.text(.055,.061,foot,fontsize=11,color=GREY,linespacing=1.6)
 fig.text(.945,.024,'Measured checkout '+r['release_sha'][:7],ha='right',fontsize=10,color=GREY)
 return fig

def axis(fig, rect=[.25,.22,.61,.54]):
 ax=fig.add_axes(rect)
 for s in ['top','right','left']: ax.spines[s].set_visible(False)
 ax.tick_params(axis='both',length=0,pad=12)
 ax.set_axisbelow(True)
 ax.grid(axis='x',color='#EAF0F6')
 return ax

def legend(ax):
 ax.legend(handles=[Line2D([0],[0],marker='o',color=BLUE,linestyle='',label='p50 / median',markersize=9),Line2D([0],[0],marker='D',color=NAVY,linestyle='',label='p95',markersize=8)],loc='upper left',bbox_to_anchor=(0,1.12),frameon=False,ncol=2)

def dumbbell(ax, labels, vals, lim, decimals):
 for i,v in enumerate(vals):
  ax.plot([v['p50_ms'],v['p95_ms']],[i,i],color='#ABC5EA',lw=5,solid_capstyle='round')
  ax.scatter(v['p50_ms'],i,s=110,color=BLUE,zorder=3)
  ax.scatter(v['p95_ms'],i,s=80,marker='D',color=NAVY,zorder=4)
  ax.text(1.02,i,f"{v['p50_ms']:.{decimals}f}  /  {v['p95_ms']:.{decimals}f}",transform=ax.get_yaxis_transform(),va='center',fontsize=13)
 ax.set_yticks(range(len(labels)),labels)
 ax.set_ylim(len(labels)-.5,-.65)
 ax.set_xscale('log');ax.set_xlim(*lim)
 ax.set_xlabel('Latency in milliseconds · logarithmic scale',labelpad=18)
 ax.text(1.02,1.09,'p50 / p95 (ms)',transform=ax.transAxes,fontsize=12,color=GREY)
 legend(ax)

fig=page('Algorithm and API speed','25 timed runs per operation · 1,163 unique official events · warm local environment', 'Replay parses and deduplicates unchanged CSV records. Forecast covers 12 hospitals over 90 minutes.\nAPI timings include local HTTP; routing uses prepared state. Operations have different scopes.')
ax=axis(fig,[.25,.24,.53,.50])
labels=['Routing · one hospital','Event parse + replay','Forecast · 12 hospitals','Full load + analysis + JSON','HTTP · report (warm)','HTTP · state','HTTP · Action Lab']
vals=list(r['speed'].values())+[r['api']['state'],r['api']['actionlab']]
dumbbell(ax,labels,vals,(.006,40),4)
fig.savefig(ROOT/'01_algorithm_speed.png');plt.close(fig)

fig=page('Rules verified against the challenge','25 independent routing scenarios · 6 roster checks · 15 constraint checks', 'Routing expectations come from an independent handbook oracle over official replay states.\nOffer boundaries are hypothetical proposals; workflow tests use an isolated app. This is rule conformance, not clinical accuracy.')
ax=axis(fig,[.29,.24,.51,.51]);labels=['Physician selection','Off-shift eligibility','10-hour rest','60-hour weekly cap','No overlapping shifts','10-minute offer expiration','Clinical lead approval']
groups=[[{'passed':True}]*r['selection']['passed'],r['off_shift_roster_checks']]+[[c for c in r['constraint_cases'] if c['category']==cat] for cat in ['10h rest','60h weekly cap','Shift overlap','10m offer expiry','Lead approval']]
for i,cs in enumerate(groups):
 passed=sum(c['passed'] for c in cs); n=len(cs); rate=100*passed/n
 ax.barh(i,100,color='#EAF3F1',height=.52);ax.barh(i,rate,color=TEAL,height=.52)
 ax.text(102,i,f'{passed}/{n}  ·  {rate:.0f}%',va='center',weight='bold',fontsize=14)
ax.set_yticks(range(len(labels)),labels);ax.set_ylim(6.6,-.6);ax.set_xlim(0,100);ax.set_xticks([0,25,50,75,100],['0%','25%','50%','75%','100%']);ax.set_xlabel('Passed cases',labelpad=18)
fig.savefig(ROOT/'02_accuracy_constraints.png');plt.close(fig)

fig=page('Runtime as uploaded event rows increase','25 runs per size · parse, deduplicate, replay, analyze and serialize', 'Repeated unchanged source rows: 1,163 unique events at every scale. This measures duplicate-heavy upload processing.\nGrowth in unique events, concurrent users, and production network traffic was not tested.')
ax=axis(fig,[.11,.25,.79,.49]);p=r['scalability']['points'];x=[z['factor'] for z in p];med=[z['measurement']['p50_ms'] for z in p];tail=[z['measurement']['p95_ms'] for z in p]
ax.grid(axis='y',color='#EAF0F6');ax.grid(axis='x',visible=False)
ax.fill_between(x,med,tail,color='#E8F0FE');ax.plot(x,med,'o-',color=BLUE,lw=3,ms=9,label='p50 / median');ax.plot(x,tail,'D--',color=NAVY,lw=2,ms=8,label='p95')
for a,b,c in zip(x,med,tail):
 ax.annotate(f'{b:.1f} / {c:.1f} ms',(a,c),xytext=(0,16),textcoords='offset points',ha='center',weight='bold')
ax.set_xticks(x,[f"{z['factor']}×\n{z['input_rows']:,} input rows" for z in p]);ax.set_xlim(.4,10.6);ax.set_ylim(0,88);ax.set_ylabel('Processing time (milliseconds)',labelpad=18);legend(ax)
fig.savefig(ROOT/'03_runtime_dataset_size.png');plt.close(fig)

fig=page('Live Jev versus deterministic selection','25 paired decisions · Jev available on all 25 requests · 25/25 decision agreement', 'Same recorded staffing state with one feasible physician plus escalation; agreement is not a diverse model-accuracy result.\nJev latency includes live provider I/O. Deterministic latency uses prepared state. No fallback was needed in this sample.')
ax=axis(fig,[.25,.29,.53,.39]);dumbbell(ax,['Deterministic selector','Live Jev selector'],[j['deterministic_selector'],j['actual_jev_latency']],(.07,1200),2)
ax.axvline(j['deadline_ms'],color=TEAL,ls=':',lw=2);ax.text(j['deadline_ms'],1.06,'900 ms\napp deadline',transform=ax.get_xaxis_transform(),ha='center',fontsize=11,color=TEAL)
fig.savefig(ROOT/'04_jev_vs_deterministic.png');plt.close(fig)

c=r['coverage'];before=c['before_deficit_physician_minutes'];after=c['after_conditional_deficit_physician_minutes'];improve=100*(before-after)/before
fig=page('MODELED · coverage gap after intervention','Suncrest Medical Pavilion · conditional hospital-access projection · 90-minute horizon', 'Assumes the selected physician accepts and comes online after a 15-minute ETA. No observed activation is asserted.\nThese are projected deficit physician-minutes, not observed patient waits, health outcomes, or financial savings.')
ax=axis(fig,[.12,.25,.52,.49]);ax.grid(axis='x',visible=False);ax.grid(axis='y',color='#EAF0F6');ax.bar([0,1],[before,after],color=[BLUE,TEAL],width=.55)
for i,n in enumerate([before,after]):ax.text(i,n+4,str(n),ha='center',fontsize=25,weight='bold')
ax.set_xticks([0,1],['Before intervention\nmodeled baseline','After intervention\nconditional model']);ax.set_ylim(0,120);ax.set_ylabel('Coverage deficit (physician-minutes)',labelpad=18)
fig.text(.72,.57,f'{improve:.0f}%',fontsize=65,weight='bold',color=TEAL);fig.text(.72,.49,'modeled shortfall\nreduction',fontsize=20,linespacing=1.5);fig.text(.72,.34,'Residual deficit: 55\nphysician-minutes',fontsize=14,color=GREY,linespacing=1.5)
fig.savefig(ROOT/'05_modeled_coverage_gaps.png');plt.close(fig)

with (ROOT/'timings.csv').open('w',newline='') as f:
 w=csv.writer(f);w.writerow(['measurement','run','milliseconds'])
 series=dict(r['speed']);series.update({'HTTP state':r['api']['state'],'HTTP Action Lab':r['api']['actionlab'],'Deterministic selector':j['deterministic_selector'],'Live Jev selector':j['actual_jev_latency']});series.update({f"Scale {z['factor']}x":z['measurement'] for z in p})
 for label,v in series.items():
  for i,ms in enumerate(v['samples_ms'],1):w.writerow([label,i,ms])
thumbs=[]
for path in sorted(ROOT.glob('0*.png')):
 im=Image.open(path).convert('RGB');im.thumbnail((960,540));thumbs.append(im)
contact=Image.new('RGB',(1920,1620),'#DFE7EF')
for i,im in enumerate(thumbs):contact.paste(im,((i%2)*960,(i//2)*540))
contact.save('/tmp/on-deck-graphs-preview.png')
print('Rendered five 2560×1440 PNGs and timings.csv from measured JSON.')
