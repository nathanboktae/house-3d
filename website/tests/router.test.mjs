import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRouter,resolveRoute,routeURL,shouldHandleLink} from '../public/router.mjs';
const routes=JSON.parse(readFileSync(new URL('../public/views.json',import.meta.url)));
function fixture(path='/house3d/'){
 const entries=[`https://example.test${path}`],listeners=new Map();let index=0;
 const browser={location:{href:entries[0]},history:{
  pushState(_state,_title,url){entries.splice(++index);entries.push(url);browser.location.href=url},
  replaceState(_state,_title,url){entries[index]=url;browser.location.href=url},
 },addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name)}};
 const travel=delta=>{index+=delta;browser.location.href=entries[index];listeners.get('popstate')?.()};
 return {browser,entries,listeners,travel};
}
test('every view resolves directly, including trailing slash and index aliases',()=>{
 for(const base of ['https://example.test/','https://example.test/house3d/']){
  for(const route of routes){
   for(const suffix of ['', '/', '/index.html'])assert.equal(resolveRoute(routes,base,`${base}${route.slug}${suffix}`),route);
  }
  assert.equal(resolveRoute(routes,base,base),routes[0]);
  assert.equal(resolveRoute(routes,base,`${base}index.html`),routes[0]);
  assert.equal(resolveRoute(routes,base,`${base}missing/`),null);
 }
 assert.equal(resolveRoute(routes,'https://example.test/house3d/','https://elsewhere.test/house3d/outside/'),null);
 assert.equal(resolveRoute(routes,'https://example.test/house3d/','https://example.test/house3d-other/outside/'),null);
});
test('root is replaced rather than added to history; repeat clicks do not add entries',()=>{
 const f=fixture(),rendered=[];
 const router=createRouter({...f,routes,baseURL:'https://example.test/house3d/',onRoute:r=>rendered.push(r.id)});
 assert.equal(f.entries.length,1);assert.match(f.browser.location.href,/\/dollhouse\/$/);
 router.navigate('upper');router.navigate('upper');assert.equal(f.entries.length,2);
 assert.deepEqual(rendered,['all','upper']);assert.throws(()=>router.navigate('missing'));
});
test('Back and Forward restore the view without pushing new entries',()=>{
 const f=fixture('/house3d/basement/'),rendered=[];
 const router=createRouter({...f,routes,baseURL:'https://example.test/house3d/',onRoute:r=>rendered.push(r.id)});
 router.navigate('outside');router.navigate('upper');
 f.travel(-1);f.travel(-1);f.travel(1);
 assert.deepEqual(rendered,['lower','outside','upper','outside','lower','outside']);assert.equal(f.entries.length,3);
 router.destroy();assert.equal(f.listeners.size,0);
});
test('refresh restores the route and navigation retains query parameters and fragment',()=>{
 const f=fixture('/house3d/outside/?labels=off#lights');let selected;
 createRouter({...f,routes,baseURL:'https://example.test/house3d/',onRoute:r=>selected=r.id});
 assert.equal(selected,'outside');assert.equal(f.entries.length,1);
 assert.equal(routeURL(routes[1],'https://example.test/house3d/',f.browser.location.href).href,'https://example.test/house3d/main-floor/?labels=off#lights');
});
test('new registry entries route without changing the router',()=>{
 const added=[...routes,{id:'garden',slug:'garden',label:'Garden'}],f=fixture('/house3d/garden/');let selected;
 createRouter({...f,routes:added,baseURL:'https://example.test/house3d/',onRoute:r=>selected=r.id});assert.equal(selected,'garden');
});
test('modified and non-left clicks preserve native link behavior',()=>{
 assert.equal(shouldHandleLink({button:0}),true);
 for(const key of ['metaKey','ctrlKey','shiftKey','altKey','defaultPrevented'])assert.equal(shouldHandleLink({button:0,[key]:true}),false);
 assert.equal(shouldHandleLink({button:1}),false);
});
