/* Optional backend loader. Does nothing while APP_CONFIG.API_BASE is empty.
   When set, it replaces the built-in arrays/objects with data from the API, then re-renders the current page.
   Failed endpoints are logged and the built-in data for that endpoint stays in place. */
(function(){
  const c=window.APP_CONFIG||{};if(!c.API_BASE)return;
  const base=c.API_BASE.replace(/\/$/,'');
  const get=p=>fetch(base+p,{headers:{Accept:'application/json'},credentials:c.CREDENTIALS||'same-origin'}).then(r=>{if(!r.ok)throw new Error(p+' -> HTTP '+r.status);return r.json()});
  const replace=(arr,data)=>{if(!Array.isArray(data))throw new Error('expected an array');arr.length=0;arr.push(...data)};
  Promise.allSettled([
    get('/news').then(d=>replace(NEWS,d)),
    get('/projects').then(d=>replace(PROJ,d)),
    get('/library').then(d=>replace(LIB,d)),
    get('/gallery').then(d=>replace(GAL,d)),
    get('/timetables').then(d=>Object.assign(TTD,d))
  ]).then(rs=>{rs.forEach(r=>{if(r.status==='rejected')console.warn('[api]',r.reason&&r.reason.message)});route()});
})();
