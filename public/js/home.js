/**
 * The landing page is static HTML in index.html; this fills the one line that depends on data, the
 * "rules as of" date from the tax file. The snapshot card is snapshot.js.
 */
export function initHome({ rates }) {
  const date = rates && rates._meta && rates._meta.compiled_on;
  if (date) document.querySelectorAll('[data-rules-date]').forEach((n) => { n.textContent = new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }); });
}
