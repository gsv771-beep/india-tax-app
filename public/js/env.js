/**
 * Which environment is this page running in?
 * Production is taxcompass.org only. Everything else (localhost, *.pages.dev previews,
 * staging.taxcompass.org) is non-production: it shows the staging banner, is never indexed
 * and exposes the dev-only fixture loader. Keep PRODUCTION_HOSTS in sync with functions/_env.js
 * and the inline script at the top of index.html.
 */
export const PRODUCTION_HOSTS = ['taxcompass.org', 'www.taxcompass.org'];

export function isProduction(hostname = location.hostname) {
  return PRODUCTION_HOSTS.includes(hostname);
}

export function environmentName(hostname = location.hostname) {
  if (isProduction(hostname)) return 'production';
  if (hostname === 'staging.taxcompass.org') return 'staging';
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'local';
  if (hostname.endsWith('.pages.dev')) return 'preview';
  return 'unknown';
}
