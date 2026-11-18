/** Static hosting needs no bootstrap; Ingress supplies only non-secret settings. */
export async function loadRuntime(baseURL, fetcher = fetch) {
  const response = await fetcher(new URL('runtime.json', baseURL), {cache: 'no-store'});
  if (response.status === 404) return {mode: 'standalone'};
  if (!response.ok) throw Error('Could not load Home Assistant app settings.');
  const config = await response.json();
  if (config.mode !== 'ingress') throw Error('Invalid Home Assistant app settings.');
  return config;
}

export function ingressConnection(baseURL) {
  const url = new URL('api/websocket', baseURL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return {ingress: true, url: url.href};
}
