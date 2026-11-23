"""Ingress-only static viewer and HA WebSocket bridge. Credentials never leave the server."""
import asyncio
import json
import os
import pwd
import weakref
from pathlib import Path

from aiohttp import ClientSession, ClientTimeout, WSMsgType, web

SESSION = web.AppKey('session', ClientSession)

VIEWS = {'dollhouse', 'main-floor', 'basement', 'outside'}


def create_app(static_dir, token, *, upstream='http://supervisor/core/websocket',
               ingress_peer='172.30.32.2', default_view='dollhouse'):
    if not token:
        raise ValueError('SUPERVISOR_TOKEN is required')
    if default_view not in VIEWS:
        raise ValueError('Invalid default_view')
    root = Path(static_dir).resolve()

    @web.middleware
    async def ingress_only(request, handler):
        # Never trust X-Forwarded-For: only Supervisor may reach this listener.
        if request.remote != ingress_peer:
            raise web.HTTPForbidden()
        response = await handler(request)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        return response

    app = web.Application(middlewares=[ingress_only])
    sockets = weakref.WeakSet()

    async def close_sockets(app):
        for socket in list(sockets):
            await socket.close(code=1001, message=b'App stopping')
    app.on_shutdown.append(close_sockets)

    async def session_context(app):
        async with ClientSession(timeout=ClientTimeout(total=None, sock_connect=15)) as session:
            app[SESSION] = session
            yield
    app.cleanup_ctx.append(session_context)

    async def runtime(request):
        return web.json_response({'mode': 'ingress', 'defaultView': default_view})

    async def websocket(request):
        browser = web.WebSocketResponse(heartbeat=30, max_msg_size=1024 * 1024)
        # Authenticate upstream before forwarding anything to the browser.
        try:
            upstream_ws = await app[SESSION].ws_connect(
                upstream, headers={'Authorization': f'Bearer {token}'}, heartbeat=30,
                max_msg_size=16 * 1024 * 1024)
            async with upstream_ws as ha:
                hello = await ha.receive_json(timeout=15)
                if hello.get('type') != 'auth_required':
                    raise ValueError('Unexpected HA handshake')
                await ha.send_json({'type': 'auth', 'access_token': token})
                auth = await ha.receive_json(timeout=15)
                if auth.get('type') != 'auth_ok':
                    raise ValueError('HA authentication failed')
                await browser.prepare(request)
                sockets.add(browser)
                await browser.send_json(hello)
                client_auth = await browser.receive_json(timeout=15)
                if client_auth.get('type') != 'auth':
                    await browser.close(code=1008)
                    return browser
                await browser.send_json(auth)

                async def relay(source, target):
                    async for message in source:
                        if message.type == WSMsgType.TEXT:
                            await target.send_str(message.data)
                        else:
                            break
                tasks = [asyncio.create_task(relay(browser, ha)), asyncio.create_task(relay(ha, browser))]
                try:
                    await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                finally:
                    for task in tasks:
                        task.cancel()
                    await asyncio.gather(*tasks, return_exceptions=True)
                    await browser.close()
        except (Exception, asyncio.TimeoutError):
            # Do not log upstream exception details, headers, URLs, or credentials.
            if browser.prepared:
                await browser.close(code=1011, message=b'Home Assistant unavailable')
            else:
                raise web.HTTPBadGateway(text='Home Assistant unavailable') from None
        return browser

    async def static(request):
        path = (root / request.match_info['path']).resolve()
        if not path.is_relative_to(root):
            raise web.HTTPNotFound()
        if path.is_dir():
            if not request.path.endswith('/'):
                # Relative redirect retains the Supervisor's external ingress prefix.
                raise web.HTTPFound(location=path.name + '/' + ('?' + request.query_string if request.query_string else ''))
            path /= 'index.html'
        if not path.is_file():
            raise web.HTTPNotFound()
        return web.FileResponse(path)

    app.router.add_get('/runtime.json', runtime)
    app.router.add_get('/api/websocket', websocket)
    app.router.add_get('/{path:.*}', static)
    return app


def startup_app(options_path=Path('/data/options.json'), static_dir='/app/static'):
    options = json.loads(options_path.read_text()) if options_path.exists() else {}
    # Supervisor owns options.json; read it before permanently dropping root.
    # Do not change the permissions or ownership of Supervisor-managed files.
    if os.geteuid() == 0:
        viewer = pwd.getpwnam('viewer')
        os.setgroups([])
        os.setgid(viewer.pw_gid)
        os.setuid(viewer.pw_uid)
    return create_app(static_dir, os.environ.get('SUPERVISOR_TOKEN', ''),
                     default_view=options.get('default_view', 'dollhouse'))


if __name__ == '__main__':
    web.run_app(startup_app(), host='0.0.0.0', port=8099, access_log=None)
