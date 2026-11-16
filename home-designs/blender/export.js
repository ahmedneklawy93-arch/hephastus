const {chromium}=require('playwright');const SP=process.argv[2],ID=process.argv[3];const fs=require('fs');
(async()=>{const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});const p=await b.newPage({viewport:{width:900,height:600}});
await p.route(/three\.min\.js/,r=>r.fulfill({path:SP+'/lib/three.min.js',contentType:'application/javascript'}));
await p.route(/OrbitControls\.js/,r=>r.fulfill({path:SP+'/lib/OrbitControls.js',contentType:'application/javascript'}));
await p.route(/fonts\.g/,r=>r.abort());
const fs2=require('fs');let html=fs2.readFileSync('/home/user/hephastus/home-designs/3d.html','utf8');html=html.replace('requestAnimationFrame(loop);\n})();','requestAnimationFrame(loop);window.__S={scene,dimG,measureG,grid,get selBox(){return selBox}};\n})();');
await p.route('http://local/3d.html',r=>r.fulfill({body:html,contentType:'text/html'}));
await p.route(/^http:\/\/local\/(img|renders)\//,r=>r.fulfill({path:'/home/user/hephastus/home-designs/'+r.request().url().slice(13)}));
await p.goto('http://local/3d.html');await p.waitForTimeout(2500);
await p.addScriptTag({path:SP+'/npmt/package/examples/js/exporters/GLTFExporter.js'});
await p.evaluate(id=>{document.getElementById('o-'+id).click();const d=document.getElementById('ly-dims');d.checked=false;d.dispatchEvent(new Event('change'))},ID);
await p.waitForTimeout(1500);
const info=await p.evaluate(()=>{const {scene,dimG,measureG,grid,selBox}=window.__S;const roots=[];scene.children.forEach(o=>{if(o.isLight||o.isCamera||o===dimG||o===measureG||o===grid||o===selBox||!o.visible)return;if(o.isLineSegments||o.isLine||o.isSprite)return;roots.push(o)});
 // strip lines/sprites/hidden inside
 const g=new THREE.Group();roots.forEach(r=>{const c=r.clone(true);const kill=[];c.traverse(o=>{if(o.isLine||o.isLineSegments||o.isSprite||o.isPoints||o.isLight||(o!==c&&!o.visible))kill.push(o)});kill.forEach(o=>o.parent&&o.parent.remove(o));g.add(c)});
 // tag materials with emissive info into names
 g.traverse(o=>{if(o.isMesh){const m=o.material;if(Array.isArray(m))return;o.userData={...o.userData,lab:o.userData.label||''};let n=o;let lab='';for(;n;n=n.parent)if(n.userData&&n.userData.label){lab=n.userData.label;break}o.name=(lab||'mesh').replace(/[^\w ]/g,'')}});
 return new Promise(res=>new THREE.GLTFExporter().parse(g,buf=>{const u=new Uint8Array(buf);let s='';for(let i=0;i<u.length;i+=32768)s+=String.fromCharCode.apply(null,u.subarray(i,i+32768));res(btoa(s))},{binary:true,maxTextureSize:1024}))});
fs.writeFileSync(SP+'/bl/'+ID+'.glb',Buffer.from(info,'base64'));
const cam=await p.evaluate(()=>{const scene=window.__S.scene;return({sun:scene.children.filter(o=>o.isDirectionalLight).map(l=>l.position.toArray())})});console.log(JSON.stringify(cam));
await b.close();console.log('ok')})();
