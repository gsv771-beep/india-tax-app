/**
 * Small inline-SVG chart library: line chart with hover crosshair, horizontal waterfall, stacked columns.
 * Thin marks, one or two hues, direct labels, legend when there is more than one series, and a
 * tooltip on hover. Colours for text and grid come from CSS variables so dark mode just works.
 */
import { el } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
export const svg = (tag, attrs = {}, children = []) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  for (const c of [].concat(children)) if (c != null) n.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return n;
};

/** ₹ figures for axes: 45k, 4.5 L, 1.2 Cr */
export function shortINR(v) {
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1e7) return `${s}₹${trim(a / 1e7)} Cr`;
  if (a >= 1e5) return `${s}₹${trim(a / 1e5)} L`;
  if (a >= 1e3) return `${s}₹${trim(a / 1e3)}k`;
  return `${s}₹${Math.round(a)}`;
}
const trim = (n) => (n >= 100 ? Math.round(n) : n >= 10 ? +n.toFixed(1) : +n.toFixed(2)).toString().replace(/\.0+$/, '');
export const fullINR = (v) => (v < 0 ? '−' : '') + '₹' + Math.round(Math.abs(v)).toLocaleString('en-IN');

function niceTicks(max, count = 5) {
  if (max <= 0) return [0];
  const rough = max / count, mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => max / s <= count) || 10 * mag;
  const ticks = [];
  for (let t = 0; t <= max + 1e-9; t += step) ticks.push(+t.toFixed(6));
  return ticks;
}
const TEXT = 'fill:var(--text)', MUTED = 'fill:var(--muted)', GRID = 'stroke:var(--line)';

/**
 * lineChart({ series: [{ name, color, points: [[x, y], ...], dash }], xFormat, yFormat, xLabel,
 *             markers: [{ x, y, label, color }], vlines: [{ x, label }], height })
 */
export function lineChart(o) {
  const W = 640, H = o.height || 240, m = { t: 18, r: 24, b: 40, l: 64 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const xs = o.series.flatMap((s) => s.points.map((p) => p[0]));
  const ys = o.series.flatMap((s) => s.points.map((p) => p[1]));
  const xmin = Math.min(...xs), xmax = Math.max(...xs) || 1;
  const ymaxRaw = Math.max(...ys, ...(o.markers || []).map((k) => k.y), 1);
  const yt = niceTicks(ymaxRaw * 1.05);
  const ymax = yt[yt.length - 1];
  const X = (x) => m.l + ((x - xmin) / (xmax - xmin || 1)) * pw;
  const Y = (y) => m.t + ph - (y / ymax) * ph;
  const xf = o.xFormat || ((x) => String(x)), yf = o.yFormat || shortINR;

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': o.ariaLabel || 'chart', class: 'viz' });
  // grid + y axis
  for (const t of yt) {
    root.append(svg('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), style: GRID, 'stroke-width': 1 }));
    root.append(svg('text', { x: m.l - 8, y: Y(t) + 4, 'text-anchor': 'end', 'font-size': 11, style: MUTED }, yf(t)));
  }
  // x ticks
  const xt = niceTicks(xmax - xmin, 6).map((t) => t + xmin).filter((t) => t <= xmax + 1e-9);
  for (const t of xt) root.append(svg('text', { x: X(t), y: H - m.b + 18, 'text-anchor': 'middle', 'font-size': 11, style: MUTED }, xf(t)));
  if (o.xLabel) root.append(svg('text', { x: m.l + pw / 2, y: H - 6, 'text-anchor': 'middle', 'font-size': 11, style: MUTED }, o.xLabel));
  root.append(svg('line', { x1: m.l, x2: W - m.r, y1: Y(0), y2: Y(0), style: 'stroke:var(--line-strong)', 'stroke-width': 1 }));

  // vertical reference lines
  for (const v of o.vlines || []) {
    root.append(svg('line', { x1: X(v.x), x2: X(v.x), y1: m.t, y2: Y(0), style: 'stroke:var(--muted)', 'stroke-dasharray': '4 4', 'stroke-width': 1.5 }));
    root.append(svg('text', { x: X(v.x) + 6, y: m.t + 12, 'font-size': 11, 'font-weight': 600, style: TEXT }, v.label));
  }
  // series
  o.series.forEach((s) => {
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
    if (s.area) root.append(svg('path', { d: d + ` L${X(s.points[s.points.length - 1][0])},${Y(0)} L${X(s.points[0][0])},${Y(0)} Z`, fill: s.color, opacity: 0.08 }));
    root.append(svg('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2.25, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': s.dash ? '6 4' : null }));
  });
  // markers
  for (const k of o.markers || []) {
    root.append(svg('circle', { cx: X(k.x), cy: Y(k.y), r: 5, fill: k.color || 'var(--text)', stroke: 'var(--surface)', 'stroke-width': 2 }));
    if (k.label) root.append(svg('text', { x: X(k.x), y: Y(k.y) - 10, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, style: TEXT }, k.label));
  }
  // legend
  const legend = el('div', { class: 'viz-legend' }, o.series.map((s) => el('span', {}, [el('i', { style: `background:${s.color}` }), s.name])));

  // hover
  const tip = el('div', { class: 'viz-tip', hidden: true });
  const cross = svg('line', { x1: 0, x2: 0, y1: m.t, y2: Y(0), style: 'stroke:var(--muted)', 'stroke-width': 1, visibility: 'hidden' });
  const dots = o.series.map((s) => svg('circle', { r: 4, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }));
  root.append(cross, ...dots);
  const wrap = el('div', { class: 'viz-wrap' }, [legend, root, tip]);
  const hit = svg('rect', { x: m.l, y: m.t, width: pw, height: ph, fill: 'transparent' });
  root.append(hit);
  const move = (clientX, clientY) => {
    const r = root.getBoundingClientRect();
    const xv = xmin + ((clientX - r.left) / r.width * W - m.l) / pw * (xmax - xmin);
    if (xv < xmin || xv > xmax) return hide();
    cross.setAttribute('x1', X(xv)); cross.setAttribute('x2', X(xv)); cross.setAttribute('visibility', 'visible');
    const rows = o.series.map((s, i) => {
      const p = s.points.reduce((best, q) => (Math.abs(q[0] - xv) < Math.abs(best[0] - xv) ? q : best), s.points[0]);
      dots[i].setAttribute('cx', X(p[0])); dots[i].setAttribute('cy', Y(p[1])); dots[i].setAttribute('visibility', 'visible');
      return el('div', {}, [el('i', { style: `background:${s.color}` }), `${s.name}: `, el('b', {}, (o.tipFormat || fullINR)(p[1]))]);
    });
    tip.replaceChildren(el('div', { class: 'viz-tip-x' }, (o.xTipFormat || xf)(xv)), ...rows);
    tip.hidden = false;
    const wr = wrap.getBoundingClientRect();
    const left = clientX - wr.left + 12, top = clientY - wr.top - 10;
    tip.style.left = Math.min(left, wr.width - tip.offsetWidth - 4) + 'px'; tip.style.top = Math.max(0, top - tip.offsetHeight) + 'px';
  };
  const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); };
  hit.addEventListener('mousemove', (e) => move(e.clientX, e.clientY));
  hit.addEventListener('touchmove', (e) => { const t = e.touches[0]; move(t.clientX, t.clientY); }, { passive: true });
  hit.addEventListener('mouseleave', hide);
  return wrap;
}

/**
 * Horizontal waterfall: steps = [{ label, value, kind: 'start' | 'minus' | 'total' | 'tax' }], scale shared with `max`.
 */
export function waterfallChart({ steps, max, color, taxColor = 'var(--danger)', title }) {
  const W = 640, rowH = 30, labelW = 230, valW = 90, m = 4;
  const H = steps.length * rowH + 8;
  const pw = W - labelW - valW - m;
  const scale = (v) => (pw * Math.max(0, v)) / (max || 1);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': title || 'waterfall', class: 'viz' });
  let running = 0;
  steps.forEach((s, i) => {
    const y = i * rowH + 4, h = rowH - 12;
    let x0, x1, fill, opacity = 1;
    if (s.kind === 'start') { x0 = 0; x1 = s.value; running = s.value; fill = 'var(--line-strong)'; }
    else if (s.kind === 'minus') { x1 = running; running = Math.max(0, running - s.value); x0 = running; fill = color; opacity = 0.45; }
    else if (s.kind === 'total') { x0 = 0; x1 = s.value; running = s.value; fill = color; }
    else { x0 = 0; x1 = s.value; fill = taxColor; }
    const g = svg('g');
    g.append(svg('title', {}, `${s.label}: ${fullINR(s.value)}`));
    g.append(svg('text', { x: labelW - 10, y: y + h / 2 + 4, 'text-anchor': 'end', 'font-size': 12, 'font-weight': s.kind === 'minus' ? 400 : 600, style: TEXT }, s.label));
    g.append(svg('rect', { x: labelW + scale(x0), y, width: Math.max(2, scale(x1) - scale(x0)), height: h, rx: 4, fill, opacity }));
    if (s.kind === 'minus' && i > 0) g.append(svg('line', { x1: labelW + scale(x1), x2: labelW + scale(x1), y1: y - 6, y2: y, style: 'stroke:var(--muted)', 'stroke-dasharray': '2 2' }));
    g.append(svg('text', { x: labelW + scale(Math.max(x0, x1)) + 8, y: y + h / 2 + 4, 'font-size': 12, style: s.kind === 'minus' ? MUTED : TEXT, 'font-weight': s.kind === 'minus' ? 400 : 700 }, (s.kind === 'minus' ? '−' : '') + shortINR(s.value)));
    root.append(g);
  });
  return el('div', { class: 'viz-wrap' }, [title ? el('div', { class: 'viz-title' }, title) : null, root]);
}

/**
 * Stacked columns: categories = ['1','2',...], series = [{ name, color, values: [] }]
 */
export function columnChart({ categories, series, yFormat = shortINR, xLabel, height = 220, tipFormat = fullINR }) {
  const W = 640, H = height, m = { t: 12, r: 12, b: 36, l: 64 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const totals = categories.map((_, i) => series.reduce((s, x) => s + (x.values[i] || 0), 0));
  const yt = niceTicks(Math.max(...totals, 1) * 1.05);
  const ymax = yt[yt.length - 1];
  const Y = (v) => m.t + ph - (v / ymax) * ph;
  const n = categories.length, slot = pw / n, bw = Math.max(2, Math.min(28, slot * 0.7));
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', class: 'viz' });
  for (const t of yt) {
    root.append(svg('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), style: GRID }));
    root.append(svg('text', { x: m.l - 8, y: Y(t) + 4, 'text-anchor': 'end', 'font-size': 11, style: MUTED }, yFormat(t)));
  }
  const every = Math.ceil(n / 12);
  categories.forEach((c, i) => {
    const x = m.l + i * slot + (slot - bw) / 2;
    let acc = 0;
    const g = svg('g');
    g.append(svg('title', {}, `${xLabel ? xLabel + ' ' : ''}${c}: ` + series.map((s) => `${s.name} ${tipFormat(s.values[i] || 0)}`).join(', ')));
    series.forEach((s, k) => {
      const v = s.values[i] || 0;
      const top = Y(acc + v), bottom = Y(acc);
      g.append(svg('rect', { x, y: top, width: bw, height: Math.max(0, bottom - top - (k < series.length - 1 ? 2 : 0)), rx: k === series.length - 1 ? 3 : 0, fill: s.color }));
      acc += v;
    });
    root.append(g);
    if (i % every === 0) root.append(svg('text', { x: x + bw / 2, y: H - m.b + 16, 'text-anchor': 'middle', 'font-size': 11, style: MUTED }, c));
  });
  if (xLabel) root.append(svg('text', { x: m.l + pw / 2, y: H - 4, 'text-anchor': 'middle', 'font-size': 11, style: MUTED }, xLabel));
  const legend = el('div', { class: 'viz-legend' }, series.map((s) => el('span', {}, [el('i', { style: `background:${s.color}` }), s.name])));
  return el('div', { class: 'viz-wrap' }, [legend, root]);
}
