/** URL-driven History API routing, independent of scene rendering. */
export function routeURL(route, baseURL, currentURL=baseURL) {
  const url=new URL(`${route.slug}/`,baseURL),current=new URL(currentURL);
  url.search=current.search;url.hash=current.hash;
  return url;
}

export function resolveRoute(routes, baseURL, href) {
  const base=new URL(baseURL),url=new URL(href);
  if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))return null;
  const path=url.pathname.slice(base.pathname.length).replace(/\/index\.html$/, '/').replace(/\/$/, '');
  if(path===''||path==='index.html')return routes[0];
  return routes.find(route=>route.slug===path)??null;
}

export function shouldHandleLink(event) {
  return !event.defaultPrevented && event.button===0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function createRouter({routes,baseURL,onRoute,browser=window}) {
  if(!routes.length)throw new Error('At least one view is required.');
  let current;
  function apply() {
    // Root and index.html are aliases. The URL, never stale history.state, is
    // authoritative on reload and popstate. Unknown routes use the default.
    const route=resolveRoute(routes,baseURL,browser.location.href)??routes[0];
    const url=routeURL(route,baseURL,browser.location.href);
    if(url.href!==browser.location.href)browser.history.replaceState(null,'',url.href);
    current=route.id;onRoute(route);
  }
  function navigate(id) {
    const route=routes.find(route=>route.id===id);
    if(!route)throw new Error(`Unknown view: ${id}`);
    if(current===id)return;
    browser.history.pushState(null,'',routeURL(route,baseURL,browser.location.href).href);
    apply();
  }
  browser.addEventListener('popstate',apply);
  apply();
  return {navigate,destroy:()=>browser.removeEventListener('popstate',apply)};
}
