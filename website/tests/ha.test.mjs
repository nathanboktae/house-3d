import test from 'node:test';
import assert from 'node:assert/strict';
import {HomeAssistant, loadConnection, saveConnection, forgetConnection, normalizeURL, DEFAULT_HA_URL, testConnection} from '../public/ha.mjs';

class MemoryStorage {
  constructor() { this.data = new Map(); }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, value); }
  removeItem(key) { this.data.delete(key); }
}
class Socket {
  static instances = [];
  constructor(url) { this.url = url; this.sent = []; Socket.instances.push(this); }
  send(value) { this.sent.push(JSON.parse(value)); }
  receive(value) { this.onmessage?.({data: JSON.stringify(value)}); }
  close() { this.closed = true; this.onclose?.(); }
}
function setup(options = {}) {
  const snapshots = [];
  const client = new HomeAssistant(s => snapshots.push(s), {Socket, retryMs: 5, ...options});
  client.start({url: DEFAULT_HA_URL, token: 'test-only-secret'});
  return {client, socket: Socket.instances.at(-1), snapshots};
}
function auth(socket) {
  socket.receive({type: 'auth_required'});
  socket.receive({type: 'auth_ok'});
  socket.receive({type: 'result', id: 1, success: true});
}
const state = (name, value, timestamp = '2026-09-28T01:00:00Z') => ({entity_id: name, state: value, attributes: {brightness: 128}, last_updated: timestamp});

test('stores HA_TOKEN locally, restores it after reload, and forgets it', () => {
  const storage = new MemoryStorage();
  assert.equal(loadConnection(storage).token, '');
  saveConnection(storage, {url: DEFAULT_HA_URL + '/', token: ' test-only-secret '});
  assert.equal(storage.getItem('HA_TOKEN'), 'test-only-secret');
  assert.deepEqual(loadConnection(storage), {url: DEFAULT_HA_URL, token: 'test-only-secret'});
  forgetConnection(storage);
  assert.equal(loadConnection(storage).token, '');
});

test('does not pair an old token with a new host on partial storage failure', () => {
  const storage = new MemoryStorage();
  saveConnection(storage, {url: DEFAULT_HA_URL, token: 'old-secret'});
  storage.setItem = () => { throw Error('Quota exceeded'); };
  assert.throws(() => saveConnection(storage, {url: 'https://other.example', token: 'new-secret'}));
  assert.equal(storage.getItem('HA_TOKEN'), null);
});

test('rejects insecure URLs, URL credentials, paths, and query-string tokens', () => {
  for (const url of ['http://ha.example', 'https://user:pass@ha.example', 'https://ha.example/api', 'https://ha.example/?token=x', 'https://ha.example/#token']) {
    assert.throws(() => normalizeURL(url));
  }
});

test('authenticates once per connection; subscribes before snapshot; filters states and handles races', t => {
  const {client, socket, snapshots} = setup(); t.after(() => client.stop());
  auth(socket);
  socket.receive({type: 'event', id: 1, event: {data: {entity_id: 'light.kitchen', new_state: state('light.kitchen', 'on', '2026-09-28T01:00:01Z')}}});
  socket.receive({type: 'result', id: 2, success: true, result: [state('light.kitchen', 'off'), state('person.nathan', 'home')]});
  assert.equal(client.status, 'connected');
  assert.deepEqual(snapshots.at(-1).entities.map(e => [e.id, e.state]), [['light.kitchen', 'on']]);
  assert.deepEqual(socket.sent.map(m => m.type), ['auth', 'subscribe_events', 'get_states']);
  assert.equal(socket.sent[0].access_token, 'test-only-secret');
  assert(!socket.url.includes('test-only-secret'));
  assert(!JSON.stringify(snapshots).includes('test-only-secret'));
  socket.receive({type: 'event', id: 1, event: {data: {entity_id: 'light.kitchen', new_state: null}}});
  assert.equal(snapshots.at(-1).entities.length, 0);
});

test('disconnect clears stale states, reconnect reauthenticates, forgetting closes the socket', async t => {
  const {client, socket, snapshots} = setup(); t.after(() => client.stop());
  auth(socket); socket.receive({type: 'result', id: 2, success: true, result: [state('light.x', 'on')]});
  socket.close();
  assert.deepEqual(snapshots.at(-1), {status: 'disconnected', entities: []});
  await new Promise(resolve => setTimeout(resolve, 15));
  const next = Socket.instances.at(-1); assert.notEqual(next, socket);
  next.receive({type: 'auth_required'});
  assert.equal(next.sent[0].access_token, 'test-only-secret');
  client.stop(); assert(next.closed); assert.equal(client.config, null);
});

test('rejected credentials stop retries; callbacks from replaced connections cannot update state', t => {
  const {client, socket} = setup(); t.after(() => client.stop());
  const lateMessage = socket.onmessage;
  socket.receive({type: 'auth_invalid', message: 'do not expose this'});
  assert.equal(client.status, 'auth_failed'); assert.equal(client.config, null);
  client.start({url: DEFAULT_HA_URL, token: 'replacement'});
  lateMessage({data: JSON.stringify({type: 'auth_invalid'})});
  assert.equal(client.status, 'connecting');
});

test('permission denial never appears as a connected empty house', t => {
  const {client, socket} = setup(); t.after(() => client.stop());
  socket.receive({type: 'auth_required'}); socket.receive({type: 'auth_ok'});
  socket.receive({type: 'result', id: 1, success: false});
  assert.equal(client.status, 'permission_denied'); assert(socket.closed);
});

test('heartbeat verifies liveness without resending the token', async t => {
  const {client, socket} = setup({heartbeatMs: 10, timeoutMs: 200}); t.after(() => client.stop());
  auth(socket); socket.receive({type: 'result', id: 2, success: true, result: []});
  await new Promise(resolve => setTimeout(resolve, 15));
  const ping = socket.sent.at(-1); assert.equal(ping.type, 'ping');
  socket.receive({type: 'pong', id: ping.id});
  assert.equal(client.status, 'connected');
  assert.equal(socket.sent.filter(m => m.access_token).length, 1);
});

test('connection probe never sends credentials or other messages', async () => {
  const promise = testConnection(DEFAULT_HA_URL, Socket);
  const socket = Socket.instances.at(-1);
  socket.receive({type: 'auth_required'});
  await promise; assert.deepEqual(socket.sent, []); assert(socket.closed);
});
