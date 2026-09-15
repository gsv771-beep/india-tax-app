/**
 * GET /robots.txt
 * Production (taxcompass.org) serves the static public/robots.txt unchanged.
 * Every other host - *.pages.dev previews, staging.taxcompass.org, anything else - gets
 * "Disallow: /", so a preview can never be indexed even if a header is dropped somewhere.
 * Layer 2 of 3; see public/_headers and the inline script in public/index.html.
 */
import { PRODUCTION_HOSTS } from './_env.js';

export async function onRequestGet({ request, env }) {
  const host = new URL(request.url).hostname;
  if (PRODUCTION_HOSTS.includes(host)) return env.ASSETS.fetch(request);
  return new Response('User-agent: *\nDisallow: /\n', {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' },
  });
}
