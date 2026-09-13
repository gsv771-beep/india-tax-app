/**
 * "Share my result": draws a square image of the tax verdict on a canvas and offers
 * native share (phones), download, or copy link. Nothing personal beyond the amounts the
 * user chooses to include.
 */
import { el, setChildren } from './util.js';

const SIZE = 1080;
const SITE_URL = location.origin.replace(/^https?:\/\//, '');

function drawCard(ctx, { verdict, sub, includeAmounts, fy }) {
  const g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  g.addColorStop(0, '#0f3d24'); g.addColorStop(0.6, '#14532d'); g.addColorStop(1, '#1a6338');
  ctx.fillStyle = g; ctx.fillRect(0, 0, SIZE, SIZE);
  // soft circles
  ctx.globalAlpha = 0.08; ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(SIZE * 0.85, SIZE * 0.15, 260, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(SIZE * 0.1, SIZE * 0.9, 200, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  const font = (w, s) => `${w} ${s}px Inter, "Segoe UI", Roboto, Arial, sans-serif`;
  // brand
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); roundRect(ctx, 80, 80, 72, 72, 18); ctx.fill();
  ctx.fillStyle = '#14532d'; ctx.font = font(800, 46); ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillText('₹', 116, 118);
  ctx.textAlign = 'left'; ctx.fillStyle = '#ffffff'; ctx.font = font(700, 44); ctx.fillText('TaxCompass', 172, 106);
  ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = font(500, 30); ctx.fillText('India', 172, 146);
  // eyebrow
  ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = font(700, 26); ctx.fillText(`MY OLD VS NEW REGIME RESULT · ${fy}`, 80, 300);
  // verdict, wrapped
  ctx.fillStyle = '#ffffff'; ctx.font = font(800, 76); ctx.textBaseline = 'alphabetic';
  wrapText(ctx, verdict, 80, 400, SIZE - 160, 90);
  if (includeAmounts && sub) { ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = font(500, 36); wrapText(ctx, sub, 80, 700, SIZE - 160, 48); }
  // footer
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = font(500, 26);
  ctx.fillText('Estimate, not tax advice. Check yours free at', 80, SIZE - 130);
  ctx.fillStyle = '#ffffff'; ctx.font = font(700, 34); ctx.fillText(SITE_URL, 80, SIZE - 80);
}
function roundRect(ctx, x, y, w, h, r) { ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function wrapText(ctx, text, x, y, maxW, lh) {
  const words = text.split(' '); let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line, x, y); y += lh; line = w; } else line = t;
  }
  if (line) ctx.fillText(line, x, y);
}

const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');

export function shareCard(cmp, fyLabel) {
  const state = { includeAmounts: true };
  const preview = el('img', { class: 'share-preview', alt: 'Preview of the shareable result image' });
  const status = el('p', { class: 'muted small', style: 'margin:6px 0 0' });
  const includeBox = el('input', { type: 'checkbox', checked: true });
  let blob = null;

  const texts = () => {
    const better = cmp.better;
    const verdict = better === 'same' ? 'Both tax regimes come out the same for me.'
      : state.includeAmounts ? `The ${better} regime saves me ${inr(cmp.saving)} this year.` : `The ${better} regime wins for me this year.`;
    const sub = `Old regime ${inr(cmp.old.tax.total)} · New regime ${inr(cmp.new.tax.total)} on a total income of ${inr(cmp.new.tax.totalIncome)}.`;
    return { verdict, sub };
  };
  const render = async () => {
    try { await document.fonts?.ready; } catch {}
    const c = document.createElement('canvas'); c.width = SIZE; c.height = SIZE;
    drawCard(c.getContext('2d'), { ...texts(), includeAmounts: state.includeAmounts, fy: fyLabel });
    blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    preview.src = URL.createObjectURL(blob);
  };
  includeBox.addEventListener('change', () => { state.includeAmounts = includeBox.checked; render(); });

  const canNative = typeof navigator.canShare === 'function';
  const shareBtn = el('button', { type: 'button', class: 'btn' }, canNative ? 'Share image' : 'Download image');
  shareBtn.addEventListener('click', async () => {
    if (!blob) await render();
    const file = new File([blob], 'my-tax-regime-result.png', { type: 'image/png' });
    if (canNative && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'My tax regime result', text: texts().verdict + ' ' + location.origin }); status.textContent = 'Shared.'; return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = el('a', { href: URL.createObjectURL(blob), download: 'my-tax-regime-result.png' });
    document.body.append(a); a.click(); a.remove();
    status.textContent = 'Image downloaded. Attach it to your post.';
  });
  const copyBtn = el('button', { type: 'button', class: 'btn secondary' }, 'Copy text and link');
  copyBtn.addEventListener('click', async () => {
    const t = `${texts().verdict} Check yours free at ${location.origin}/tax`;
    try { await navigator.clipboard.writeText(t); status.textContent = 'Copied.'; } catch { status.textContent = t; }
  });

  const panel = el('div', { class: 'share-panel', hidden: true }, [
    preview,
    el('label', { class: 'check' }, [includeBox, 'Include the rupee amounts on the image']),
    el('div', { class: 'btn-row' }, [shareBtn, copyBtn]),
    status,
  ]);
  const toggle = el('button', { type: 'button', class: 'btn secondary share-toggle' }, 'Share my result');
  toggle.addEventListener('click', async () => { panel.hidden = !panel.hidden; if (!panel.hidden && !blob) await render(); });
  return el('div', { class: 'share' }, [toggle, panel]);
}
