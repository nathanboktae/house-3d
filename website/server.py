"""Local, read-only Home Assistant bridge. Secrets never enter browser responses."""
import asyncio
import contextlib
import json
import os
import ssl
import truststore
from pathlib import Path
from urllib.parse import urlparse
from aiohttp import ClientSession, ClientTimeout, web
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
DEFAULT_URL = 'https://home-assistant.example'

class Bridge:
    def __init__(self, url, token):
        self.url = url.rstrip('/')
        parsed = urlparse(self.url)
        if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1')):
            raise ValueError('HA_URL must use HTTPS (HTTP is allowed only for loopback tests).')
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError('HA_URL must be a plain instance URL.')
        self.token = token
        self.status = 'not_configured' if not token else 'connecting'
        self.entities = {}
        self.clients = set()

    def snapshot(self):
        return {'status': self.status, 'entities': sorted(self.entities.values(), key=lambda e:e['name'])}

    def publish(self):
        data = self.snapshot()
        for queue in self.clients:
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(data)

    def apply(self, state, entity_id=None):
        entity_id = entity_id or (state or {}).get('entity_id', '')
        if entity_id.split('.')[0] not in ('light', 'switch'):
            return
        if state is None:
            self.entities.pop(entity_id, None)
            return
        old = self.entities.get(entity_id)
        if old and old['updated'] > state.get('last_updated', ''):
            return
        attrs = state.get('attributes', {})
        self.entities[entity_id] = {'id':entity_id, 'name':attrs.get('friendly_name', entity_id), 'state':state['state'], 'brightness':attrs.get('brightness'), 'updated':state.get('last_updated', '')}

    async def run(self):
        if not self.token:
            return
        delay = 1
        while True:
            self.status = 'connecting'; self.publish()
            try:
                async with ClientSession(timeout=ClientTimeout(total=None, sock_connect=15)) as session:
                    url = self.url.replace('https://', 'wss://', 1).replace('http://', 'ws://', 1) + '/api/websocket'
                    async with session.ws_connect(url, heartbeat=25, max_msg_size=16*1024*1024, ssl=truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)) as ws:
                        hello = await ws.receive_json(timeout=20)
                        if hello.get('type') != 'auth_required':
                            raise ValueError('Unexpected handshake')
                        await ws.send_json({'type':'auth','access_token':self.token})
                        auth = await ws.receive_json(timeout=20)
                        if auth.get('type') == 'auth_invalid':
                            self.status = 'auth_failed'; self.entities.clear(); self.publish(); return
                        if auth.get('type') != 'auth_ok':
                            raise ValueError('Unexpected authentication response')
                        await ws.send_json({'id':1,'type':'subscribe_events','event_type':'state_changed'})
                        reply = await ws.receive_json(timeout=20)
                        if reply.get('id') != 1 or not reply.get('success'):
                            raise ValueError('Subscription rejected')
                        await ws.send_json({'id':2,'type':'get_states'})
                        buffered = []
                        while True:
                            reply = await ws.receive_json(timeout=30)
                            if reply.get('type') == 'event':
                                buffered.append(reply); continue
                            if reply.get('id') == 2:
                                if not reply.get('success'):
                                    raise ValueError('State snapshot rejected')
                                self.entities.clear()
                                for state in reply['result']:
                                    self.apply(state)
                                break
                        for event in buffered:
                            data = event['event']['data']; self.apply(data.get('new_state'),data.get('entity_id'))
                        self.status = 'connected'; delay = 1; self.publish()
                        async for message in ws:
                            if message.type == web.WSMsgType.TEXT:
                                event = json.loads(message.data)
                                if event.get('type') == 'event' and event.get('id') == 1:
                                    data = event['event']['data']; self.apply(data.get('new_state'),data.get('entity_id')); self.publish()
            except asyncio.CancelledError:
                raise
            except Exception:
                # Never print exception bodies: upstream failures can contain sensitive data.
                pass
            self.status = 'disconnected'; self.entities.clear(); self.publish()
            await asyncio.sleep(delay); delay = min(delay * 2, 30)

@web.middleware
async def local_only(request, handler):
    if request.host.split(':')[0] not in ('127.0.0.1','localhost'):
        raise web.HTTPForbidden(text='Local access only')
    origin = request.headers.get('Origin')
    if origin and origin != f'{request.scheme}://{request.host}':
        raise web.HTTPForbidden(text='Same-origin access only')
    response = await handler(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Cache-Control'] = 'no-store' if request.path.startswith('/api/') else 'no-cache'
    return response

def make_app(bridge):
    app = web.Application(middlewares=[local_only])
    async def status(request):
        return web.json_response(bridge.snapshot())
    async def events(request):
        response = web.StreamResponse(headers={'Content-Type':'text/event-stream','Cache-Control':'no-store'})
        await response.prepare(request)
        queue = asyncio.Queue(maxsize=1); bridge.clients.add(queue); queue.put_nowait(bridge.snapshot())
        try:
            while True:
                try:
                    snapshot = await asyncio.wait_for(queue.get(), 15)
                    await response.write(('data: '+json.dumps(snapshot)+'\n\n').encode())
                except asyncio.TimeoutError:
                    await response.write(b': heartbeat\n\n')
        except (ConnectionResetError, asyncio.CancelledError):
            pass
        finally:
            bridge.clients.discard(queue)
        return response
    async def index(request):
        return web.FileResponse(ROOT/'public/index.html')
    async def model(request):
        return web.FileResponse(ROOT.parent/'matterport-house/output/house.glb')
    async def lifecycle(app):
        task = asyncio.create_task(bridge.run())
        yield
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError): await task
    app.cleanup_ctx.append(lifecycle)
    app.router.add_get('/',index)
    app.router.add_get('/model/house.glb',model)
    app.router.add_get('/api/status',status)
    app.router.add_get('/api/events',events)
    app.router.add_static('/assets/',ROOT/'public',show_index=False)
    app.router.add_static('/vendor/three/',ROOT.parent/'matterport-house/scripts/node_modules/three',show_index=False)
    return app

if __name__ == '__main__':
    load_dotenv(ROOT/'.env')
    bridge = Bridge(os.getenv('HA_URL',DEFAULT_URL), os.getenv('HA_TOKEN','').strip())
    web.run_app(make_app(bridge), host='127.0.0.1', port=int(os.getenv('PORT','8787')), access_log=None)
