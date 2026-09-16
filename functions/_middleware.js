/**
 * Per-route <head> at the edge. The app is one index.html, so without this every shared link
 * unfurls as the tax page. For HTML navigations the middleware rewrites the title, description,
 * canonical and Open Graph tags to match the path, using the same route table as the client.
 * Redirects, assets, data and API calls pass straight through.
 */
import { metaFor } from '../public/js/routes.js';

export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  const path = url.pathname;
  const isPage = request.method === 'GET' && !path.startsWith('/api/') && !/\.[a-z0-9]+$/i.test(path);
  const res = await next();
  if (!isPage || res.status !== 200 || !(res.headers.get('content-type') || '').includes('text/html')) return res;

  const m = metaFor(path);
  const set = (attr, value) => ({ element(e) { e.setAttribute(attr, value); } });
  return new HTMLRewriter()
    .on('title', { element(e) { e.setInnerContent(m.title); } })
    .on('meta[name="description"]', set('content', m.desc))
    .on('meta[property="og:title"]', set('content', m.title))
    .on('meta[property="og:description"]', set('content', m.desc))
    .on('meta[property="og:url"]', set('content', m.url))
    .on('link[rel="canonical"]', set('href', m.url))
    .transform(res);
}
