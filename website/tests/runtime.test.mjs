import test from 'node:test';
import assert from 'node:assert/strict';
import {loadRuntime,ingressConnection} from '../public/runtime.mjs';

test('static hosts without runtime config retain local-storage mode', async()=>{
  assert.deepEqual(await loadRuntime('https://example.test/house/',async()=>({status:404})),{mode:'standalone'});
});
test('ingress bootstrap contains settings and preserves its mounted path', async()=>{
  const runtime=await loadRuntime('https://example.test/api/hassio_ingress/session/', async(url)=>{
    assert.equal(url.pathname,'/api/hassio_ingress/session/runtime.json');
    return {ok:true,json:async()=>({mode:'ingress',defaultView:'outside'})};
  });
  assert.equal(runtime.defaultView,'outside');
  assert.deepEqual(ingressConnection('https://example.test/api/hassio_ingress/session/'),{ingress:true,url:'wss://example.test/api/hassio_ingress/session/api/websocket'});
  assert.equal(ingressConnection('http://homeassistant.local:8123/api/hassio_ingress/session/').url,'ws://homeassistant.local:8123/api/hassio_ingress/session/api/websocket');
});
test('bootstrap errors do not silently fall back to another HA connection', async()=>{
  await assert.rejects(loadRuntime('https://example.test/',async()=>({status:502,ok:false})));
});
