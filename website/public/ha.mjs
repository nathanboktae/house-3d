/** Browser-only Home Assistant WebSocket client. Never authenticates asset requests. */
export const DEFAULT_HA_URL = 'https://home-assistant.example';
export const TOKEN_KEY = 'HA_TOKEN';
export const URL_KEY = 'HA_URL';

export function normalizeURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('Use an HTTPS Home Assistant origin, without a path or credentials.');
  }
  return url.origin;
}

export function loadConnection(storage) {
  const url = normalizeURL(storage.getItem(URL_KEY) || DEFAULT_HA_URL);
  return {url, token: (storage.getItem(TOKEN_KEY) || '').trim()};
}

export function saveConnection(storage, {url, token}) {
  const config = {url: normalizeURL(url), token: token.trim()};
  if (!config.token) throw new Error('Enter a long-lived access token.');
  // Remove the old secret first so a partial storage failure cannot pair it with a new host.
  storage.removeItem(TOKEN_KEY);
  storage.setItem(URL_KEY, config.url);
  storage.setItem(TOKEN_KEY, config.token);
  return config;
}

export function forgetConnection(storage) {
  storage.removeItem(TOKEN_KEY);
  storage.removeItem(URL_KEY);
}

export class HomeAssistant {
  constructor(onState, {Socket = globalThis.WebSocket, retryMs = 1000, heartbeatMs = 25000, timeoutMs = 15000} = {}) {
    Object.assign(this, {onState, Socket, retryMs, heartbeatMs, timeoutMs});
    this.generation = 0;
    this.pending = new Map();
    this.entities = new Map();
    this.status = 'not_configured';
  }

  publish(status = this.status) {
    this.status = status;
    this.onState({status, entities: [...this.entities.values()].sort((a, b) => a.name.localeCompare(b.name))});
  }

  clearTimers() {
    clearTimeout(this.retryTimer);
    clearTimeout(this.deadline);
    clearInterval(this.heartbeat);
  }

  cancelCommands() {
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('Connection closed; command outcome unknown. Check the device state.')); }
    this.pending.clear();
    this.sendCommand = null;
  }

  setEntity(id, on) {
    if (this.status !== 'connected' || !this.sendCommand) return Promise.reject(new Error('Connect Home Assistant first.'));
    const entity = this.entities.get(id);
    if (!/^(light|switch)\.[a-z0-9_]+$/.test(id) || !entity || !['on','off'].includes(entity.state) || entity.members?.length) return Promise.reject(new Error('Choose an available individual light or switch, not a group.'));
    return this.sendCommand({type:'call_service', domain:id.split('.')[0], service:on?'turn_on':'turn_off', target:{entity_id:id}});
  }

  stop(status = 'not_configured') {
    this.cancelCommands();
    this.generation++;
    this.clearTimers();
    if (this.socket) {
      this.socket.onopen = this.socket.onmessage = this.socket.onclose = this.socket.onerror = null;
      this.socket.close();
      this.socket = null;
    }
    this.config = null;
    this.entities.clear();
    this.publish(status);
  }

  start(config) {
    const url = normalizeURL(config.url);
    this.stop();
    if (!config.token) return;
    this.config = {url, token: config.token};
    this.delay = this.retryMs;
    this.connect();
  }

  apply(state, id = state?.entity_id) {
    if (typeof id !== 'string' || !/^(light|switch)\./.test(id)) return;
    if (!state) { this.entities.delete(id); return; }
    const old = this.entities.get(id);
    if (old && old.updated > (state.last_updated || '')) return;
    const attrs = state.attributes || {};
    this.entities.set(id, {
      id, name: String(attrs.friendly_name || id), state: state.state,
      members: Array.isArray(attrs.entity_id) ? attrs.entity_id : [],
      brightness: Number.isFinite(attrs.brightness) ? attrs.brightness : null,
      updated: state.last_updated || '',
    });
  }

  connect() {
    const generation = ++this.generation;
    this.entities.clear();
    this.publish('connecting');
    let socket;
    try { socket = new this.Socket(this.config.url.replace('https:', 'wss:') + '/api/websocket'); }
    catch { this.stop('connection_error'); return; }
    this.socket = socket;
    let phase = 'hello', buffered = [], nextID = 3, awaitingPong = null;
    const current = () => generation === this.generation;
    const timeout = () => { clearTimeout(this.deadline); this.deadline = setTimeout(() => socket.close(), this.timeoutMs); };
    const send = value => socket.send(JSON.stringify(value));
    this.sendCommand = command => new Promise((resolve,reject) => {
      const id=nextID++;
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Command timed out; check the device state before trying again.'));},this.timeoutMs);
      this.pending.set(id,{resolve,reject,timer});
      try { send({...command,id}); } catch { clearTimeout(timer);this.pending.delete(id);reject(new Error('Could not send command.')); }
    });
    timeout();
    socket.onmessage = event => {
      if (!current()) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'result' && this.pending.has(message.id)) {
          const request=this.pending.get(message.id);this.pending.delete(message.id);clearTimeout(request.timer);
          if(message.success)request.resolve();else request.reject(new Error('Home Assistant rejected the command: '+(message.error?.code || 'unknown error')));
          return;
        }
        if (message.type === 'auth_invalid') { this.stop('auth_failed'); return; }
        if (phase === 'hello' && message.type === 'auth_required') {
          send({type: 'auth', access_token: this.config.token});
          phase = 'auth'; timeout();
        } else if (phase === 'auth' && message.type === 'auth_ok') {
          send({id: 1, type: 'subscribe_events', event_type: 'state_changed'});
          phase = 'subscription'; timeout();
        } else if (phase === 'subscription' && message.type === 'result' && message.id === 1) {
          if (!message.success) { this.stop('permission_denied'); return; }
          send({id: 2, type: 'get_states'}); phase = 'snapshot'; timeout();
        } else if (message.type === 'event' && message.id === 1) {
          if (phase === 'snapshot') {
            buffered.push(message.event.data);
            if (buffered.length > 10000) socket.close();
          } else if (phase === 'live') {
            const data = message.event.data;
            this.apply(data.new_state, data.entity_id); this.publish();
          }
        } else if (phase === 'snapshot' && message.type === 'result' && message.id === 2) {
          if (!message.success || !Array.isArray(message.result)) { this.stop('permission_denied'); return; }
          for (const state of message.result) this.apply(state);
          for (const data of buffered) this.apply(data.new_state, data.entity_id);
          buffered = []; phase = 'live'; clearTimeout(this.deadline); this.delay = this.retryMs;
          this.publish('connected');
          this.heartbeat = setInterval(() => {
            if (!current()) return;
            if (awaitingPong !== null) { socket.close(); return; }
            awaitingPong = nextID++; send({id: awaitingPong, type: 'ping'}); timeout();
          }, this.heartbeatMs);
        } else if (message.type === 'pong' && message.id === awaitingPong) {
          awaitingPong = null; clearTimeout(this.deadline);
        }
      } catch { this.stop('protocol_error'); }
    };
    socket.onerror = () => { if (current()) socket.close(); };
    socket.onclose = () => {
      if (!current()) return;
      this.cancelCommands(); this.clearTimers(); this.entities.clear(); this.publish('disconnected');
      this.retryTimer = setTimeout(() => { if (current() && this.config) this.connect(); }, this.delay);
      this.delay = Math.min(this.delay * 2, 30000);
    };
  }
}

/** Checks the real browser's cross-origin handshake without sending a token. */
export function testConnection(url, Socket = globalThis.WebSocket) {
  return new Promise((resolve, reject) => {
    const socket = new Socket(normalizeURL(url).replace('https:', 'wss:') + '/api/websocket');
    let finished = false;
    const finish = ok => {
      if (finished) return;
      finished = true; clearTimeout(timer); socket.onclose = socket.onerror = socket.onmessage = null; socket.close();
      if (ok) resolve(); else reject(new Error('Could not reach Home Assistant from this browser. Check its URL and remote access.'));
    };
    const timer = setTimeout(() => finish(false), 15000);
    socket.onmessage = event => { try { finish(JSON.parse(event.data).type === 'auth_required'); } catch { finish(false); } };
    socket.onerror = socket.onclose = () => finish(false);
  });
}
