/**
 * Per-route <head> at the edge. The app is one index.html, so without this every shared link
 * unfurls as the tax page. For HTML navigations the middleware rewrites the title, description,
 * canonical and Open Graph tags to match the path, using the same route table as the client.
 * The salary pages (/salary, /salary/<n>-lakh) also get their content rendered here, so the answer
 * is in the HTML a search engine fetches, with the page's questions as FAQ structured data.
 * Redirects, assets, data and API calls pass straight through.
 */
import { metaFor } from '../public/js/routes.js';
import { salaryPageModel, salaryPageHtml, salaryIndexHtml, salaryJsonLd } from '../public/engine/salary-page.js';

let ratesCache = null;
async function loadRates(env, url) {
  if (ratesCache) return ratesCache;
  const res = await env.ASSETS.fetch(new URL('/data/tax_rates.json', url));
  if (!res.ok) return null;
  ratesCache = await res.json();
  return ratesCache;
}

/** The salary page's body, description and structured data, or null when it cannot be rendered. */
export async function salarySsr(m, env, url) {
  if (m.tab !== 'salary' || !env || !env.ASSETS) return null;
  const rates = await loadRates(env, url).catch(() => null);
  if (!rates) return null;
  if (!m.ctc) return { html: salaryIndexHtml(rates), desc: m.desc, jsonLd: null };
  const model = salaryPageModel(m.ctc, rates);
  return { html: salaryPageHtml(model), desc: model.answer, jsonLd: salaryJsonLd(model) };
}

export async function onRequest({ request, next, env }) {
  const url = new URL(request.url);
  const path = url.pathname;
  const isPage = request.method === 'GET' && !path.startsWith('/api/') && !/\.[a-z0-9]+$/i.test(path);
  const res = await next();
  if (!isPage || res.status !== 200 || !(res.headers.get('content-type') || '').includes('text/html')) return res;

  const m = metaFor(path);
  const ssr = await salarySsr(m, env, url);
  const desc = ssr ? ssr.desc : m.desc;
  const set = (attr, value) => ({ element(e) { e.setAttribute(attr, value); } });
  let rw = new HTMLRewriter()
    .on('title', { element(e) { e.setInnerContent(m.title); } })
    .on('meta[name="description"]', set('content', desc))
    .on('meta[property="og:title"]', set('content', m.title))
    .on('meta[property="og:description"]', set('content', desc))
    .on('meta[property="og:url"]', set('content', m.url))
    .on('link[rel="canonical"]', set('href', m.url));
  if (ssr) {
    rw = rw
      .on('section#salary', { element(e) { e.removeAttribute('hidden'); } })
      .on('#salary-ssr', { element(e) { e.setInnerContent(ssr.html, { html: true }); e.setAttribute('data-shown', m.ctc ? `ctc:${m.ctc}` : 'index'); } });
    if (ssr.jsonLd) rw = rw.on('head', { element(e) { e.append(`<script type="application/ld+json">${JSON.stringify(ssr.jsonLd).replace(/</g, '\\u003c')}</script>`, { html: true }); } });
  }
  return rw.transform(res);
}
