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
    list.replaceChildren(...terms.map((t) => el('div', { class: 'term' }, [
      el('div', { class: 'cat' }, t.cat.replace(/-/g, ' ')),
      el('h3', {}, t.term),
      el('p', {}, t.def),
    ])));
    if (!terms.length) list.append(el('div', { class: 'notice' }, 'No matching terms. Try the chat tab for anything not covered here.'));
  }

  search.addEventListener('input', render);
  renderCats();
  render();
}
