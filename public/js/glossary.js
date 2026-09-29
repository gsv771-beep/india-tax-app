import { el } from './util.js';

export function initGlossary({ glossary }) {
  const list = document.getElementById('glossary-list');
  const search = document.getElementById('glossary-search');
  const cats = document.getElementById('glossary-cats');
  let activeCat = 'all';

  const catButton = (id, label) => el('button', {
    class: id === activeCat ? 'active' : '',
    onclick: () => { activeCat = id; renderCats(); render(); },
  }, label);

  function renderCats() {
    cats.replaceChildren(catButton('all', 'All'), ...glossary._meta.categories.map((c) => catButton(c, c.replace(/-/g, ' '))));
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    const terms = glossary.terms.filter((t) =>
      (activeCat === 'all' || t.cat === activeCat) &&
      (!q || t.term.toLowerCase().includes(q) || t.def.toLowerCase().includes(q)),
    );
    // terms named by the search come before ones that only mention it
    if (q) terms.sort((x, y) => (y.term.toLowerCase().includes(q) ? 1 : 0) - (x.term.toLowerCase().includes(q) ? 1 : 0));
    list.replaceChildren(...terms.map((t) => el('div', { class: 'term' }, [
      el('div', { class: 'cat' }, t.cat.replace(/-/g, ' ')),
      el('h3', {}, t.term),
      el('p', {}, t.def),
    ])));
    if (!terms.length) list.append(el('div', { class: 'notice' }, 'No matching terms. Try another word, or ask with the Ask button at the bottom of the page.'));
  }

  // /glossary?q=HRA (from Ask TaxCompass) opens on that term, on arrival or on a later link
  const fromUrl = () => { const q = new URLSearchParams(location.search).get('q'); if (q != null && location.pathname.startsWith('/glossary')) { search.value = q; activeCat = 'all'; renderCats(); render(); } };
  window.addEventListener('routechange', fromUrl);
  search.addEventListener('input', render);
  renderCats();
  render();
  fromUrl();
}
