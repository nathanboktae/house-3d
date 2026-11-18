import asyncio
import tempfile
import unittest
from pathlib import Path

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from server import create_app


class IngressTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'index.html').write_text('viewer')
        (self.root / 'main-floor').mkdir()
        (self.root / 'main-floor/index.html').write_text('floor')
        self.clients = []

    async def asyncTearDown(self):
        for client in reversed(self.clients):
            await client.close()
        self.temp.cleanup()

    async def client(self, **kwargs):
        app = create_app(self.root, 'synthetic-supervisor-secret', **kwargs)
        client = TestClient(TestServer(app))
        await client.start_server()
        self.clients.append(client)
        return client

    async def test_only_supervisor_peer_is_trusted(self):
        client = await self.client()
        for path in ['/', '/runtime.json', '/api/websocket']:
            response = await client.get(path, headers={'X-Forwarded-For': '172.30.32.2'})
            self.assertEqual(response.status, 403)

    async def test_bootstrap_and_deep_links_contain_no_credentials(self):
        client = await self.client(ingress_peer='127.0.0.1', default_view='main-floor')
        response = await client.get('/runtime.json')
        self.assertEqual(await response.json(), {'mode': 'ingress', 'defaultView': 'main-floor'})
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        redirect = await client.get('/main-floor', allow_redirects=False)
        self.assertEqual(redirect.status, 302)
        self.assertEqual(redirect.headers['Location'], 'main-floor/')
        response = await client.get('/main-floor/')
        self.assertEqual(await response.text(), 'floor')
        self.assertEqual((await client.get('/missing')).status, 404)
        outside = self.root.parent / 'outside-secret.txt'
        outside.write_text('must not serve')
        try:
            (self.root / 'leak').symlink_to(outside)
            self.assertEqual((await client.get('/leak')).status, 404)
        finally:
            outside.unlink()

    async def test_websocket_auth_stays_server_side_and_messages_relay(self):
        closed = asyncio.Event()
        async def ha(request):
            self.assertEqual(request.headers['Authorization'], 'Bearer synthetic-supervisor-secret')
            ws = web.WebSocketResponse()
            await ws.prepare(request)
            await ws.send_json({'type': 'auth_required', 'ha_version': 'test'})
            self.assertEqual(await ws.receive_json(), {'type': 'auth', 'access_token': 'synthetic-supervisor-secret'})
            await ws.send_json({'type': 'auth_ok', 'ha_version': 'test'})
            command = await ws.receive_json()
            self.assertEqual(command, {'id': 1, 'type': 'get_states'})
            await ws.send_json({'id': 1, 'type': 'result', 'success': True, 'result': []})
            await ws.close()
            closed.set()
            return ws
        upstream = web.Application()
        upstream.router.add_get('/core/websocket', ha)
        async with TestServer(upstream) as server:
            client = await self.client(ingress_peer='127.0.0.1', upstream=str(server.make_url('/core/websocket')))
            async with client.ws_connect('/api/websocket') as ws:
                self.assertEqual((await ws.receive_json())['type'], 'auth_required')
                await ws.send_json({'type': 'auth', 'access_token': 'ingress'})
                self.assertEqual((await ws.receive_json())['type'], 'auth_ok')
                await ws.send_json({'id': 1, 'type': 'get_states'})
                result = await ws.receive_json()
                self.assertEqual(result['result'], [])
                self.assertNotIn('synthetic-supervisor-secret', str(result))
            await asyncio.wait_for(closed.wait(), 2)

    async def test_upstream_failure_does_not_disclose_details(self):
        client = await self.client(ingress_peer='127.0.0.1', upstream='http://127.0.0.1:1/core/websocket')
        response = await client.get('/api/websocket')
        self.assertEqual(response.status, 502)
        self.assertEqual(await response.text(), 'Home Assistant unavailable')

    def test_missing_token_and_invalid_view_fail_startup(self):
        with self.assertRaises(ValueError):
            create_app(self.root, '')
        with self.assertRaises(ValueError):
            create_app(self.root, 'test', default_view='../bad')

if __name__ == '__main__':
    unittest.main()
