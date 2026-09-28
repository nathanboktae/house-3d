import asyncio
import contextlib
import json
import sys
import unittest
from pathlib import Path
from aiohttp import web
from aiohttp.test_utils import TestServer, TestClient
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import Bridge, make_app

class BridgeTests(unittest.IsolatedAsyncioTestCase):
    async def test_auth_snapshot_live_event_and_disconnect(self):
        commands=[]; release=asyncio.Event()
        async def mock(request):
            ws=web.WebSocketResponse(); await ws.prepare(request)
            await ws.send_json({'type':'auth_required'})
            commands.append(await ws.receive_json()); await ws.send_json({'type':'auth_ok'})
            commands.append(await ws.receive_json()); await ws.send_json({'id':1,'type':'result','success':True,'result':None})
            commands.append(await ws.receive_json())
            await ws.send_json({'id':2,'type':'result','success':True,'result':[
                {'entity_id':'light.kitchen','state':'off','attributes':{'friendly_name':'Kitchen'},'last_updated':'2026-01-01T00:00:00'},
                {'entity_id':'person.private','state':'home','attributes':{'latitude':12}}]})
            await release.wait()
            await ws.send_json({'id':1,'type':'event','event':{'data':{'entity_id':'light.kitchen','new_state':{'entity_id':'light.kitchen','state':'on','attributes':{'brightness':128},'last_updated':'2026-01-01T00:00:01'}}}})
            await ws.close(); return ws
        app=web.Application();app.router.add_get('/api/websocket',mock)
        async with TestServer(app) as upstream:
            bridge=Bridge(str(upstream.make_url('')).rstrip('/'),'test-secret')
            q=asyncio.Queue(maxsize=10);bridge.clients.add(q);task=asyncio.create_task(bridge.run())
            try:
                while True:
                    data=await asyncio.wait_for(q.get(),3)
                    if data['status']=='connected':break
                self.assertEqual([e['id'] for e in data['entities']],['light.kitchen'])
                self.assertNotIn('test-secret',json.dumps(data));self.assertNotIn('latitude',json.dumps(data))
                release.set()
                data=await asyncio.wait_for(q.get(),3);self.assertEqual(data['entities'][0]['state'],'on');self.assertEqual(data['entities'][0]['brightness'],128)
                data=await asyncio.wait_for(q.get(),3);self.assertEqual(data['status'],'disconnected');self.assertEqual(data['entities'],[])
                self.assertEqual([c['type'] for c in commands],['auth','subscribe_events','get_states'])
            finally:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):await task

    async def test_invalid_token_is_terminal_and_does_not_leak(self):
        async def mock(request):
            ws=web.WebSocketResponse();await ws.prepare(request);await ws.send_json({'type':'auth_required'});await ws.receive_json();await ws.send_json({'type':'auth_invalid','message':'test-secret'});await ws.close();return ws
        app=web.Application();app.router.add_get('/api/websocket',mock)
        async with TestServer(app) as upstream:
            bridge=Bridge(str(upstream.make_url('')).rstrip('/'),'test-secret');await asyncio.wait_for(bridge.run(),3)
            self.assertEqual(bridge.status,'auth_failed');self.assertNotIn('test-secret',json.dumps(bridge.snapshot()))

    async def test_http_boundary_and_no_secret_files(self):
        async with TestClient(TestServer(make_app(Bridge('https://example.com','')))) as client:
            response=await client.get('/api/status');self.assertEqual(response.status,200);self.assertEqual((await response.json())['status'],'not_configured')
            for path in ['/.env','/assets/../.env','/server.py']:
                response=await client.get(path);self.assertEqual(response.status,404)
            response=await client.get('/api/status',headers={'Origin':'https://evil.example'});self.assertEqual(response.status,403)
            response=await client.get('/api/status',headers={'Host':'evil.example'});self.assertEqual(response.status,403)

    def test_out_of_order_state_does_not_regress(self):
        b=Bridge('https://example.com','')
        b.apply({'entity_id':'light.x','state':'on','last_updated':'2026-02','attributes':{}})
        b.apply({'entity_id':'light.x','state':'off','last_updated':'2026-01','attributes':{}})
        self.assertEqual(b.entities['light.x']['state'],'on')
        b.apply(None,'light.x');self.assertFalse(b.entities)

if __name__=='__main__':unittest.main()
