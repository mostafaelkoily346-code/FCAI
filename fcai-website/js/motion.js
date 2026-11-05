/* ===== cinematic motion layer ===== */
const fine=matchMedia('(hover:hover) and (pointer:fine)'),rm=matchMedia('(prefers-reduced-motion:reduce)');
function go(){if(document.startViewTransition&&!rm.matches){const d=document.documentElement;d.classList.add('vt');const t=document.startViewTransition(()=>route());t.finished.finally(()=>d.classList.remove('vt'))}else route()}
let fr=0,le=null,mg=null;const MG='.cta .btn,.fab',clr=(el,ks)=>ks.forEach(k=>el.style.removeProperty(k));
document.addEventListener('pointermove',e=>{if(e.pointerType!='mouse'||!fine.matches||rm.matches)return;le=e;if(!fr)fr=requestAnimationFrame(()=>{fr=0;const t=le.target;if(!t.closest)return;const c=t.closest('.card,.yr'),b=t.closest(MG);
 if(c){const r=c.getBoundingClientRect(),x=le.clientX-r.left,y=le.clientY-r.top;c.style.setProperty('--lx',x+'px');c.style.setProperty('--ly',y+'px');if(c.matches('.dep,.yr')){c.style.setProperty('--ry',((x/r.width-.5)*8).toFixed(2)+'deg');c.style.setProperty('--rx',((.5-y/r.height)*8).toFixed(2)+'deg')}}
 if(b){const r=b.getBoundingClientRect();b.style.setProperty('--tx',((le.clientX-r.left-r.width/2)*.2).toFixed(1)+'px');b.style.setProperty('--ty',((le.clientY-r.top-r.height/2)*.3).toFixed(1)+'px')}
 if(mg&&mg!==b)clr(mg,['--tx','--ty']);mg=b})},{passive:true});
document.addEventListener('pointerout',e=>{const t=e.target;if(!t.closest)return;const c=t.closest('.dep,.yr'),b=t.closest(MG);if(c&&!c.contains(e.relatedTarget))clr(c,['--rx','--ry']);if(b&&!b.contains(e.relatedTarget))clr(b,['--tx','--ty'])});
document.addEventListener('pointerdown',e=>{if(rm.matches)return;const b=e.target.closest&&e.target.closest('.btn');if(!b)return;const r=b.getBoundingClientRect(),s=mk('span','rp');s.style.left=(e.clientX-r.left)+'px';s.style.top=(e.clientY-r.top)+'px';b.append(s);s.addEventListener('animationend',()=>s.remove())});
const pxs=new Set();let pxr=0;
const pio=new IntersectionObserver(es=>es.forEach(e=>e.isIntersecting?pxs.add(e.target):pxs.delete(e.target)),{rootMargin:'120px'});
const pxu=()=>{pxr=0;pxs.forEach(el=>{const r=el.parentElement.getBoundingClientRect(),m=(r.top+r.height/2-innerHeight/2)/innerHeight;el.style.transform=`translate3d(0,${(m*-26).toFixed(1)}px,0) scale(1.14)`})};
addEventListener('scroll',()=>{if(pxs.size&&!pxr)pxr=requestAnimationFrame(pxu)},{passive:true});
const cio=new IntersectionObserver(es=>es.forEach(e=>{if(!e.isIntersecting)return;cio.unobserve(e.target);const el=e.target,to=+el.dataset.count;if(rm.matches)return;const t0=performance.now();(function f(t){const p=Math.min(1,(t-t0)/1400);el.textContent=N(Math.round(to*(1-Math.pow(1-p,3))));if(p<1)requestAnimationFrame(f)})(t0)}),{threshold:.5});
function motion(){
 $$('.hero h1 .ln>span:not(.sp)').forEach(sp=>{sp.classList.add('sp');const w=sp.textContent.trim().split(/\s+/);sp.textContent='';w.forEach((x,i)=>{const k=mk('span','wd',x);k.style.setProperty('--i',$$('.wd').length);sp.append(k);if(i<w.length-1)sp.append(' ')})});
 const h=$('#hero');if(h&&!h.querySelector('.hb')){['--p:.25;width:520px;height:520px;top:-170px;inset-inline-start:-150px','--p:.55;width:340px;height:340px;bottom:-120px;inset-inline-end:8%;border-color:rgba(242,169,59,.2)'].forEach(a=>{const d=mk('span','hb');d.style.cssText=a;d.setAttribute('aria-hidden','true');h.prepend(d)})}
 $$('.sh:not(.rv)').forEach(e=>{e.classList.add('rv');io.observe(e)});
 pio.disconnect();pxs.clear();if(!rm.matches&&innerWidth>700)$$('.edit .ph svg').forEach(e=>pio.observe(e));
 $$('[data-count]').forEach(e=>cio.observe(e))}
const post0=post;post=function(){post0();motion()};
