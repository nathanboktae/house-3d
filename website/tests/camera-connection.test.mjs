import test from 'node:test';
import assert from 'node:assert/strict';
import {CameraConnection} from '../public/camera-connection.mjs';
function fixture(){
 let time=0,id=0;const jobs=new Map(),reports=[];
 const image={naturalWidth:0,removeAttribute(){this.src='';this.naturalWidth=0}};
 const connection=new CameraConnection(image,(...args)=>reports.push(args),{
  now:()=>time,setTimer:(fn,delay)=>{jobs.set(++id,{fn,at:time+delay});return id},clearTimer:key=>jobs.delete(key)
 });
 const advance=ms=>{const end=time+ms;while(true){const next=[...jobs].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;time=next[1].at;jobs.delete(next[0]);next[1].fn()}time=end};
 connection.update('https://example.test/stream?token=camera-token');
 return {connection,image,reports,jobs,advance};
}
test('errors back off to two minutes; repeated state updates do not bypass the wait',()=>{
 const f=fixture();
 for(const delay of [5000,10000,20000,40000,80000,120000,120000]){
  f.image.onerror();assert.equal(f.reports.at(-1)[1],delay);
  f.connection.update('https://example.test/stream?token=camera-token');
  f.advance(delay-1);assert.equal(f.image.src,'');
  f.advance(1);assert.ok(f.image.src);assert.equal(f.reports.at(-1)[0],'connecting');
 }
});
test('hung initial connections time out and retry',()=>{
 const f=fixture();f.advance(30000);
 assert.equal(f.reports.at(-1)[0],'retrying');assert.match(f.reports.at(-1)[2],/timed out/);
 f.advance(5000);assert.equal(f.reports.at(-1)[0],'connecting');
});
test('multipart first frame is recognized without load; stable connection resets backoff',()=>{
 const f=fixture();f.image.onerror();f.advance(5000);
 f.image.naturalWidth=640;f.advance(1000);
 assert.equal(f.reports.at(-1)[0],'live');assert.equal(f.image.hidden,false);
 f.advance(60000);f.image.onerror();assert.equal(f.reports.at(-1)[1],5000);
});
test('stop cancels retries and ignores stale callbacks',()=>{
 const f=fixture(),stale=f.image.onerror;
 f.image.onerror();f.connection.stop();stale();f.advance(120000);
 assert.equal(f.jobs.size,0);assert.equal(f.image.src,'');
 f.connection.update('https://example.test/new');stale();assert.equal(f.reports.at(-1)[0],'connecting');
});
test('brief recovery retains backoff; manual retry starts immediately',()=>{
 const f=fixture();f.image.onerror();f.advance(5000);f.image.naturalWidth=640;f.advance(1000);
 f.image.onerror();assert.equal(f.reports.at(-1)[1],10000);
 f.connection.retry();assert.equal(f.reports.at(-1)[0],'connecting');assert.equal(f.jobs.size,1);
});
