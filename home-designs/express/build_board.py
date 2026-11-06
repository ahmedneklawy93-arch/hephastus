import base64,html,sys
import os
SP=os.path.join(os.path.dirname(os.path.abspath(__file__)),'renders')+'/'
img=lambda n:'data:image/jpeg;base64,'+base64.b64encode(open(SP+n+'.jpg','rb').read()).decode()
OPTS=[
('A','Pebble Line','Extend the annex in one straight line','≈ 140 m²','19 × 4 m lap','$',
 'The house continues straight on from the annex along the north edge, with the same pebble base, ochre render and clay-tile edge. The raised middle room opens south through four arched glass doors to a terrace and a 19 m lap pool.',
 ['Joined to the annex: one continuous building','The lawn stays open to the south','Lowest cost, one-phase build'],
 ['A long façade needs the raised middle to avoid looking like a barracks']),
('B','Riwaq Courtyard','A U-shaped house around a private pool','≈ 220 m²','7 × 6 m','$$$',
 'The back wing runs along the north edge beside the annex, with an arched riwaq (shaded loggia) in front. Two short wings frame a courtyard pool that opens south to the lawn.',
 ['Arches repeat the annex’s timber door','The pool is sheltered on three sides','Annex becomes the guest suite'],
 ['Largest floor area and highest cost','Courtyard needs cross-ventilation in summer']),
('C','Palm Pavilions','Three small houses joined by a timber walkway','≈ 140 m²','≈ 95 m² free-form','$$',
 'Three pavilions with clay-tile roofs step east from the annex along the north edge, linked by a covered timber walkway. A free-form pool curves across the lawn toward the date palms, 3 m clear of their trunks.',
 ['Build one pavilion at a time','Scale stays close to the annex','Every palm stays in place'],
 ['Moving between rooms means stepping outside']),
('D','Hedge-Edge Modern','A flat-roofed glass bar against the north hedge','≈ 140 m²','18 × 4 m mirror','$$',
 'A thin roof slab floats over a glass wall facing south across the lawn. Pebble end walls tie it to the annex, and a timber screen covers the bedrooms. The whole lawn stays open.',
 ['Biggest open lawn of the five','The north hedge forms the back wall','Night reflections in the mirror pool'],
 ['The biggest stylistic step away from the annex','Glass needs deep overhangs or low-E glazing']),
('E','Vaulted Long House','Egyptian vernacular: vaults, a dome and a wind-catcher','≈ 140 m² + riwaq','8 × 8 m birka + rill','$$',
 'Barrel-vaulted rooms in the Hassan Fathy tradition, with a domed majlis at the centre and a malqaf wind-catcher at the far end. A square birka pool with a fountain sits on the dome’s axis, fed by a narrow rill.',
 ['Passive cooling from thick walls and the malqaf','Ochre, pebble and arches carried through','Strong local identity'],
 ['Vaults and domes need an experienced builder','The pool is for cooling off, not swimming laps']),
]
e=html.escape
css='''
*{box-sizing:border-box;margin:0;padding:0}
body{background:#14191c}
.slide{position:relative;width:1920px;height:1080px;overflow:hidden;background:#f3efe6;color:#1f2420;font-family:"ibm-plex-sans",sans-serif}
.disp{font-family:"cormorant-garamond",serif;font-weight:500}
.mono{font-family:"ibm-plex-mono",monospace}
'''
S=[]
# 1 cover
S.append(f'''<div class="slide" style="background:#0d1a2b">
<img src="{img('gate')}" style="position:absolute;left:0;top:0;width:1920px;height:1080px;object-fit:cover">
<div style="position:absolute;left:0;top:0;width:1920px;height:440px;background:linear-gradient(180deg,rgba(13,26,43,.88),rgba(13,26,43,0))"></div>
<p class="mono" style="position:absolute;left:96px;top:84px;font-size:22px;letter-spacing:4px;color:#e9b46a">HOUSE + POOL DESIGN STUDIES</p>
<h1 class="disp" style="position:absolute;left:96px;top:124px;width:1300px;font-size:104px;line-height:1.02;color:#fbf6ec">Palm Garden Long House</h1>
<p style="position:absolute;left:100px;top:262px;width:1100px;font-size:30px;line-height:1.4;color:#e8e1d2">Five single-storey options, each built on the right side of the existing annex. View: standing at the gate, looking down the driveway to the annex door.</p>
</div>''')
# 2 site
S.append(f'''<div class="slide">
<img src="{img('night')}" style="position:absolute;left:960px;top:0;width:960px;height:1080px;object-fit:cover">
<p class="mono" style="position:absolute;left:96px;top:96px;font-size:20px;letter-spacing:4px;color:#a8682a">THE SITE, RECALIBRATED</p>
<h2 class="disp" style="position:absolute;left:96px;top:136px;width:780px;font-size:68px;line-height:1.05">Gate, driveway, annex, then the new house</h2>
<div style="position:absolute;left:96px;top:330px;width:780px;font-size:27px;line-height:1.5;color:#3a413b">
<p style="margin-bottom:22px">The driveway runs along the short side of the land, straight from the gate to the annex door. Coming in, the boundary wall is on your left and the whole land is on your right.</p>
<p style="margin-bottom:22px">Every option starts at the annex and runs along the north edge on its right side, facing south, so the lawn, the date palms and the hedges stay open in front of the new house.</p>
<p>All five repeat the annex’s river pebble, ochre render, clay-tile edge and arched timber openings.</p></div>
<p class="mono" style="position:absolute;left:96px;top:960px;width:780px;font-size:18px;color:#6b726c">Right: option B at night. Sizes are estimated from site photos.</p>
</div>''')
for (k,n,kick,area,pool,cost,desc,keeps,watch) in OPTS:
    li=lambda a:''.join(f'<p style="margin-bottom:10px">— {e(x)}</p>' for x in a)
    S.append(f'''<div class="slide">
<img src="{img(k)}" style="position:absolute;left:0;top:0;width:1240px;height:1080px;object-fit:cover">
<div style="position:absolute;left:1240px;top:0;width:680px;height:1080px;background:#f3efe6"></div>
<p class="mono" style="position:absolute;left:1310px;top:88px;font-size:20px;letter-spacing:4px;color:#a8682a">OPTION {k}</p>
<h2 class="disp" style="position:absolute;left:1310px;top:124px;width:560px;font-size:70px;line-height:1.02">{e(n)}</h2>
<p style="position:absolute;left:1312px;top:214px;width:560px;font-size:24px;color:#5a615b">{e(kick)}</p>
<div class="mono" style="position:absolute;left:1312px;top:300px;width:560px;height:96px;border-top:3px solid #a8682a;padding-top:14px;font-size:24px;line-height:1.5">
<p>{e(area)} new</p><p>Pool {e(pool)} · cost {cost}</p></div>
<p style="position:absolute;left:1312px;top:430px;width:560px;font-size:22px;line-height:1.5;color:#2c322d">{e(desc)}</p>
<p class="mono" style="position:absolute;left:1312px;top:700px;font-size:16px;letter-spacing:3px;color:#6b726c">GAINS</p>
<div style="position:absolute;left:1312px;top:730px;width:560px;font-size:20px;line-height:1.35">{li(keeps)}</div>
<p class="mono" style="position:absolute;left:1312px;top:900px;font-size:16px;letter-spacing:3px;color:#6b726c">WATCH FOR</p>
<div style="position:absolute;left:1312px;top:930px;width:560px;font-size:20px;line-height:1.35">{li(watch)}</div>
</div>''')
rows=''.join(f'<tr><td style="padding:16px 18px;border-bottom:1px solid #d8d0c0"><b>{k}</b> &nbsp;{e(n)}</td><td class="mono" style="padding:16px 18px;border-bottom:1px solid #d8d0c0">{e(a)}</td><td class="mono" style="padding:16px 18px;border-bottom:1px solid #d8d0c0">{e(p)}</td><td class="mono" style="padding:16px 18px;border-bottom:1px solid #d8d0c0">{c}</td></tr>' for (k,n,_,a,p,c,*r) in OPTS)
S.append(f'''<div class="slide">
<p class="mono" style="position:absolute;left:96px;top:96px;font-size:20px;letter-spacing:4px;color:#a8682a">SIDE BY SIDE</p>
<h2 class="disp" style="position:absolute;left:96px;top:136px;width:1400px;font-size:68px">Comparing the five options</h2>
<table style="position:absolute;left:96px;top:290px;width:1728px;border-collapse:collapse;font-size:28px;text-align:left">
<tr style="color:#6b726c;font-size:20px"><th style="padding:12px 18px">Option</th><th style="padding:12px 18px">New built area</th><th style="padding:12px 18px">Pool</th><th style="padding:12px 18px">Cost</th></tr>{rows}</table>
<p style="position:absolute;left:96px;top:880px;width:1600px;font-size:24px;line-height:1.5;color:#3a413b">Next steps: a measured site survey, the setback and height rules for the plot, and a soil test for the pool. Keep the pool at least 3 m from the palm trunks and use one warm 2700 K light colour throughout.</p>
</div>''')
doc=f'''<!doctype html><html><head><meta charset="utf-8"><meta name="hz:slide-selector" content=".slide"><meta name="hz:canvas-width" content="1920"><meta name="hz:canvas-height" content="1080">
<title>Palm Garden Long House</title><link rel="stylesheet" href="https://use.typekit.net/fms4zom.css"><style>{css}</style></head><body>
{''.join(S)}
</body></html>'''
open(SP+'../deck.html','w').write(doc);print(len(doc))
