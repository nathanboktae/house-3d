#!/usr/bin/env python3
"""Read HA areas/floors and lighting registry metadata; never persist credentials."""
import asyncio
import json
import os
import ssl
from datetime import datetime, timezone
from pathlib import Path
import aiohttp
import truststore
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT/'website/private/room-labeling'
DEFAULT_URL = 'https://home-assistant.example'

async def main():
    config = None
    for path in (ROOT/'.env', ROOT/'website/.env'):
        if path.is_file():
            candidate = dotenv_values(path)
            if candidate.get('HA_TOKEN', '').strip():
                config = candidate
                break
    if config is None:
        raise RuntimeError('No nonempty HA_TOKEN found in root .env or website/.env.')
    token = config['HA_TOKEN'].strip()
    url = (config.get('HA_URL') or DEFAULT_URL).rstrip('/')
    if not url.startswith('https://'):
        raise RuntimeError('HA_URL must use HTTPS.')
    results = {}; notes = []
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60)) as session:
        async with session.ws_connect(url.replace('https:', 'wss:', 1)+'/api/websocket', ssl=truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)) as ws:
            hello = await ws.receive_json(timeout=15)
            if hello.get('type') != 'auth_required':
                raise RuntimeError('Unexpected authentication handshake.')
            await ws.send_json({'type':'auth', 'access_token':token})
            auth = await ws.receive_json(timeout=15)
            if auth.get('type') != 'auth_ok':
                raise RuntimeError('Home Assistant rejected the configured token.')
            for request_id, (name, command) in enumerate([
                ('floors','config/floor_registry/list'),
                ('areas','config/area_registry/list'),
                ('devices','config/device_registry/list'),
                ('registry','config/entity_registry/list'),
                ('states','get_states'),
            ], 1):
                await ws.send_json({'id':request_id,'type':command})
                message = await ws.receive_json(timeout=30)
                if message.get('id') != request_id:
                    raise RuntimeError('Unexpected command response.')
                if message.get('success'):
                    results[name] = message['result']
                else:
                    results[name] = []
                    notes.append(f'{name}: request not available ({message.get("error",{}).get("code", "unknown")})')
    devices = {d['id']:d for d in results['devices']}
    registry = {e['entity_id']:e for e in results['registry']}
    states = {e['entity_id']:e for e in results['states']}
    entities = []
    for entity_id in sorted(set(registry)|set(states)):
        if not entity_id.startswith(('light.', 'switch.')):
            continue
        entry = registry.get(entity_id,{})
        state = states.get(entity_id,{})
        attrs = state.get('attributes',{})
        device = devices.get(entry.get('device_id'),{})
        entities.append({
            'entity_id':entity_id,
            'name':attrs.get('friendly_name') or entry.get('name') or entry.get('original_name') or entity_id,
            'area_id':entry.get('area_id') or device.get('area_id'),
            'area_source':'entity' if entry.get('area_id') else 'device' if device.get('area_id') else None,
            'device_name':device.get('name_by_user') or device.get('name'),
            'state':state.get('state','not_loaded'),
            'disabled_by':entry.get('disabled_by'),
            'hidden_by':entry.get('hidden_by'),
            'entity_category':entry.get('entity_category'),
            'platform':entry.get('platform'),
            'members':[e for e in attrs.get('entity_id',[]) if isinstance(e,str) and e.startswith(('light.','switch.'))] if isinstance(attrs.get('entity_id'),list) else [],
        })
    inventory = {
        'retrieved_at':datetime.now(timezone.utc).isoformat(),
        'floors':[{k:f.get(k) for k in ('floor_id','name','level','aliases')} for f in results['floors']],
        'areas':[{k:a.get(k) for k in ('area_id','name','floor_id','aliases')} for a in results['areas']],
        'entities':entities,
        'notes':notes,
    }
    DEST.mkdir(parents=True,exist_ok=True)
    fd = os.open(DEST/'ha-inventory.json',os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as file:
        json.dump(inventory,file,indent=2)
    print(json.dumps({'authenticated':True,'floors':inventory['floors'],'areas':inventory['areas'],'light_count':sum(e['entity_id'].startswith('light.') for e in entities),'switch_count':sum(e['entity_id'].startswith('switch.') for e in entities),'notes':notes},indent=2))

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception as error:
        # Exception type only: HTTP libraries may include request details in exception text.
        print(f'Inspection failed: {type(error).__name__}. No credentials were written to output.')
        raise SystemExit(1)
