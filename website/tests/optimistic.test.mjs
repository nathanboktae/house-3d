import test from 'node:test';
import assert from 'node:assert/strict';
import {OptimisticControls} from '../public/optimistic.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){
 const calls=[],messages=[],timers=new Set();
 const model=new OptimisticControls((id,on,brightness)=>new Promise((resolve,reject)=>calls.push({id,on,brightness,resolve,reject})),message=>messages.push(message),{schedule:f=>{timers.add(f);return f},cancel:f=>timers.delete(f)});
 const report=(brightness=51,state='on',updated='1',status='connected')=>model.reconcile({status,entities:[{id:'light.office',name:'Office',state,brightness,updated,dimmable:true,members:[]}]});
 report();
 return {model,calls,messages,timers,report,entity:()=>model.project().entities[0]};
}
test('slider stays optimistic through acknowledgement and intermediate device states',async()=>{
 const {model,calls,report,entity,timers}=setup();
 model.set('light.office',true,80);assert.equal(entity().brightness,204);
 report(51);assert.equal(entity().brightness,204);
 calls[0].resolve();await tick();assert.equal(entity().brightness,204);
 report(120,'on','2');assert.equal(entity().brightness,204);
 report(203,'on','3');assert.equal(entity().brightness,203);
 assert.equal(model.intents.size,0);assert.equal(timers.size,0);
 report(80,'on','4');assert.equal(entity().brightness,80);
});
test('device confirmation before command acknowledgement also settles',async()=>{
 const {model,calls,report}=setup();model.set('light.office',true,80);
 report(204,'on','2');calls[0].resolve();await tick();assert.equal(model.intents.size,0);
});
test('rapid edits coalesce and stale completions cannot overwrite newest intent',async()=>{
 const {model,calls,report,entity}=setup();
 model.set('light.office',true,40);model.set('light.office',true,60);model.set('light.office',true,80);
 assert.equal(calls.length,1);assert.equal(entity().brightness,204);
 calls[0].resolve();await tick();assert.equal(calls.length,2);assert.equal(calls[1].brightness,80);
 report(102,'on','2');assert.equal(entity().brightness,204);
 calls[1].resolve();await tick();assert.equal(entity().brightness,204);
 report(204,'on','3');assert.equal(model.intents.size,0);
});
test('rejection rolls back to latest reported state, not the original state',async()=>{
 const {model,calls,report,entity,messages}=setup();model.set('light.office',true,80);
 report(90,'on','2');calls[0].reject(new Error('Rejected'));await tick();
 assert.equal(entity().brightness,90);assert.equal(model.intents.size,0);assert.ok(messages.includes('Rejected'));
});
test('failure of superseded command does not roll back a newer edit',async()=>{
 const {model,calls,entity,messages}=setup();model.set('light.office',true,40);model.set('light.office',true,80);
 calls[0].reject(new Error('Old failure'));await tick();assert.equal(entity().brightness,204);
 assert.equal(calls[1].brightness,80);assert.ok(!messages.includes('Old failure'));
});
test('unconfirmed accepted command expires and reports reconciliation',async()=>{
 const {model,calls,report,entity,timers,messages}=setup();model.set('light.office',true,80);
 calls[0].resolve();await tick();report(90,'on','2');
 [...timers][0]();assert.equal(entity().brightness,90);assert.equal(model.intents.size,0);
 assert.match(messages.at(-1),/not confirmed/);
});
test('disconnect clears intent and prevents an old worker sending queued commands',async()=>{
 const {model,calls,report,entity,timers}=setup();model.set('light.office',true,40);model.set('light.office',true,80);
 report(51,'on','1','disconnected');assert.equal(model.intents.size,0);
 report();model.set('light.office',true,60);assert.equal(calls.length,2);
 calls[0].resolve();await tick();assert.equal(calls.length,2);assert.equal(entity().brightness,153);
 calls[1].resolve();await tick();assert.equal(timers.size,1);
 report(51,'unavailable','2');assert.equal(model.intents.size,0);assert.equal(timers.size,0);
});
test('toggles and zero brightness update immediately and retain command order',async()=>{
 const {model,calls,entity,report}=setup();model.set('light.office',false,0);assert.equal(entity().state,'off');
 calls[0].resolve();await tick();report(51,'off','2');assert.equal(model.intents.size,0);
 model.set('light.office',true);assert.equal(entity().state,'on');assert.equal(calls[1].on,true);
});
