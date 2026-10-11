from pathlib import Path
import html
out=Path('/Users/b/Projects/RUHealthHacks/output/architecture')
p=[]
def add(s):p.append(s)
def text(x,y,lines,size=22,weight=400,color='#172b36',anchor='middle',gap=28):
 for i,line in enumerate(lines if isinstance(lines,list) else [lines]):add(f'<text x="{x}" y="{y+i*gap}" text-anchor="{anchor}" font-size="{size}" font-weight="{weight}" fill="{color}">{html.escape(line)}</text>')
def path(d,stroke='#253640',width=2.5,arrow=True):add(f'<path d="{d}" fill="none" stroke="{stroke}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"'+(' marker-end="url(#arrow)"' if arrow else '')+'/>')
def use(name,x,y,scale=1):add(f'<use href="#{name}" transform="translate({x} {y}) scale({scale})"/>')
add('''<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1050" viewBox="0 0 1800 1050"><defs>
<marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10Z" fill="#253640"/></marker>
<linearGradient id="blue" x2="1" y2="1"><stop stop-color="#32bded"/><stop offset="1" stop-color="#1365d7"/></linearGradient>
<linearGradient id="teal" x2="1" y2="1"><stop stop-color="#1fd398"/><stop offset="1" stop-color="#087565"/></linearGradient>
<symbol id="person" viewBox="-60 -60 120 120"><circle cx="0" cy="-29" r="20" fill="none" stroke="#0f584c" stroke-width="5"/><path d="M-39 51V26C-39-13 39-13 39 26V51Z" fill="none" stroke="#0f584c" stroke-width="5"/></symbol>
<g id="user"><circle cy="-29" r="20" fill="none" stroke="#0f584c" stroke-width="5"/><path d="M-39 51V26C-39-13 39-13 39 26V51Z" fill="none" stroke="#0f584c" stroke-width="5"/></g>
<g id="csv"><path d="M-37-51H17L39-28V50H-37Z" fill="#f1f7ff" stroke="#2464cf" stroke-width="5"/><path d="M17-51V-28H39" fill="none" stroke="#2464cf" stroke-width="4"/><rect x="-24" y="-12" width="49" height="43" rx="4" fill="none" stroke="#2464cf" stroke-width="3"/><path d="M-24 2H25M-24 17H25M-7-12V31M9-12V31" stroke="#2464cf" stroke-width="2.5"/></g>
<g id="react" fill="none" stroke="#17b8df" stroke-width="6"><ellipse rx="71" ry="27"/><ellipse rx="71" ry="27" transform="rotate(60)"/><ellipse rx="71" ry="27" transform="rotate(120)"/><circle r="12" fill="#17b8df" stroke="none"/></g>
<g id="api"><path d="M-48-38L-88 0L-48 38M48-38L88 0L48 38" fill="none" stroke="url(#blue)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><rect x="-29" y="-47" width="58" height="94" rx="8" fill="#edf6ff" stroke="#1475cf" stroke-width="4"/><path d="M-17-18H17M-17 10H17" stroke="#1475cf" stroke-width="4"/><circle cx="14" cy="-32" r="4" fill="#12a778"/><circle cx="14" cy="-4" r="4" fill="#12a778"/><circle cx="14" cy="26" r="4" fill="#12a778"/></g>
<g id="jev"><path d="M0-66C12-20 25-13 66 0C23 12 13 25 0 66C-12 23-24 12-66 0C-23-12-12-25 0-66Z" fill="url(#teal)"/><path d="M51-66L56-50L72-45L56-40L51-24L46-40L30-45L46-50Z" fill="#edb529"/></g>
<g id="rules"><rect x="-46" y="-48" width="92" height="96" rx="17" fill="#e9f3ff" stroke="#286ed0" stroke-width="4"/><path d="M-28-20L-22-14L-11-28M-28 6L-22 12L-11-2M-28 32L-22 38L-11 24" fill="none" stroke="#087565" stroke-width="5"/><path d="M1-21H29M1 5H29M1 31H29" stroke="#286ed0" stroke-width="5" stroke-linecap="round"/></g>
<g id="database"><path d="M-55-37V37C-55 66 55 66 55 37V-37" fill="#e7f4ff" stroke="#1972cf" stroke-width="4"/><ellipse cy="-37" rx="55" ry="21" fill="url(#blue)" stroke="#1972cf" stroke-width="4"/><path d="M-55-10C-55 19 55 19 55-10M-55 17C-55 46 55 46 55 17" fill="none" stroke="#1972cf" stroke-width="4"/></g>
<g id="approval"><path d="M0-60L53-41V1C53 36 27 53 0 68C-27 53-53 36-53 1V-41Z" fill="#edf9f3" stroke="#087565" stroke-width="4"/><path d="M-27 0L-8 20L30-24" fill="none" stroke="#087565" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></g>
<g id="source"><rect x="-53" y="-40" width="82" height="88" rx="8" fill="#e8f5ee" stroke="#0b8064" stroke-width="4"/><rect x="-29" y="-54" width="82" height="88" rx="8" fill="#fff" stroke="#0b8064" stroke-width="4"/><path d="M-13-30H35M-13-10H35M-13 10H35" stroke="#0b8064" stroke-width="4"/></g>
</defs><rect width="1800" height="1050" fill="#fff"/><g font-family="Arial, Helvetica, sans-serif">''')
# Actual Relay mark, scaled from the application glyph.
add('''<svg x="502" y="27" width="83" height="66" viewBox="270 340 720 570"><defs><mask id="mark-mask"><rect x="270" y="340" width="720" height="570" fill="white"/><circle cx="345" cy="445" r="77" fill="black"/><circle cx="915" cy="603" r="74" fill="black"/><circle cx="857" cy="835" r="76" fill="black"/></mask></defs><g mask="url(#mark-mask)" fill="none" stroke="#0f4339"><path d="M330 399H800A125 125 0 0 1 925 524V600" stroke-width="82"/><path d="M395 548H580A102 102 0 0 1 682 650V690C682 735 704 763 740 787L860 862" stroke-width="74" stroke-linecap="round"/><path d="M690 643H900" stroke-width="64"/></g><circle cx="345" cy="445" r="61" fill="#1fcf8d"/><circle cx="915" cy="603" r="58" fill="#1fcf8d"/><circle cx="857" cy="835" r="60" fill="#087a68"/></svg>''')
text(600,80,'Relay',57,700,'#0f4339',anchor='start');text(771,80,'Architecture',57,700,'#111',anchor='start')
path('M603 101H1280','#c49622',3,False)
text(900,139,'Sevaro Command Center · implemented application architecture',21,color='#61717c')
# Flows behind icons.
path('M495 303V347');text(510,328,'CSV upload',19,anchor='start')
path('M181 423H338');text(257,400,'Role-based access',17)
path('M595 423H773');path('M773 423H595');text(685,378,['Reports · replay','review · actions'],19,gap=25)
path('M985 423H1280');path('M1280 423H985');text(1128,373,['Eligible choices /','typed decision'],19,gap=25)
path('M274 776H313Q335 776 364 751L782 614');text(410,682,'Validate · deduplicate · ingest',18)
path('M846 700V613');path('M846 613V700');text(865,651,['Calculate /','reconstruct'],18,anchor='start',gap=24)
path('M610 762L781 614');path('M781 614L610 762');text(690,769,['Persist /','read state'],18,gap=24)
path('M983 614L1362 748');text(1240,646,['Reviewable offers','with audit trail'],18,gap=24)
# User and application.
use('user',120,423);text(120,503,['Operations team'],23,700);text(120,535,['Coordinator','Clinical lead','Physician'],19,gap=25)
use('csv',495,209);text(495,281,'Imported event CSV',23,700)
use('react',470,423);text(470,522,'React + TypeScript',28,700);text(470,553,'Coverage desk · Scenario lab',21,600,'#1666c1');text(470,586,['Import real records','Play / Pause recorded time points','Review physician selections'],19,gap=26)
use('api',880,423);text(880,522,'FastAPI + Python',28,700);text(880,553,'Authenticated /api/v1',21,600,'#1666c1');text(880,586,'Orchestration · access control',19)
# AI option grouping.
path('M1318 275Q1296 275 1296 300V403Q1296 423 1283 423Q1296 423 1296 443V590Q1296 615 1318 615','#c49622',2.5,False)
use('jev',1460,297,.8);text(1460,384,'TypeSafe Jev · advisory',27,700);text(1460,416,['Selects among code-approved actions','Deadline + confidence checks'],19,gap=25)
use('rules',1460,525,.7);text(1460,600,'Deterministic · fallback',26,700);text(1460,632,'Timeout · uncertainty · unavailable',19)
# Bottom-tier systems.
use('source',194,781);text(194,870,'Official challenge CSVs',23,700);text(194,903,['Events · rosters · credentials','Shifts · baseline arrivals'],19,gap=25)
use('database',552,801);text(552,889,'PostgreSQL',26,700);text(552,921,['Events · sessions · imports','Decisions · offers · audit'],19,gap=25)
use('rules',846,771);text(846,854,'Deterministic engine',26,700);text(846,885,['Historical replay · consult routing','Modeled coverage forecasts','Credentials · rest · workload gates'],19,gap=25)
text(846,971,'Replay frames: private 30-minute memory cache',17,color='#61717c')
use('approval',1460,791,.8);text(1460,882,'Human-approved workflow',26,700);text(1460,914,['Propose → clinical-lead approval','Simulated send → physician response'],19,gap=26)
# Footer; claims deliberately bounded.
path('M90 996H1710','#d7e1e7',1,False)
text(900,1027,'Supplied records only · Playback is read-only · Forecasts are modeled · No automatic assignments or real notifications',18,color='#526571')
add('</g></svg>')
(out/'relay-architecture.svg').write_text(''.join(p))
