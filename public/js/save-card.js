/**
 * The "save this" card, shared by the tax page, the calculators, the budget and the profile: one
 * Download button. The file (an Excel workbook, or the profile's JSON) is built in the browser and
 * saved straight away; nothing is sent anywhere and nothing is asked for.
 * opts: { title, intro, source, buildBase64: async () => string, fileName: () => string, downloadLabel? }
 */
import { el } from './util.js';

// the email form this card used to have kept a name and address in this browser; nothing asks for them now
try { localStorage.removeItem('taxcompass.person.v1'); } catch {}

const MIME = { json: 'application/json', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
/** Save base64 content as a file, without a round trip to any server. */
export function downloadBase64(base64, fileName) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = (/\.([a-z0-9]+)$/i.exec(fileName) || [])[1] || 'xlsx';
  const url = URL.createObjectURL(new Blob([bytes], { type: MIME[ext.toLowerCase()] || 'application/octet-stream' }));
  const a = el('a', { href: url, download: fileName, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function saveFileCard(opts) {
  const isProfile = opts.source === 'profile';
  const status = el('p', { class: 'muted', style: 'margin:8px 0 0', role: 'status' });
  const download = el('button', { type: 'button', class: 'btn' }, opts.downloadLabel || (isProfile ? 'Download my profile' : 'Download Excel'));
  download.addEventListener('click', async () => {
    download.disabled = true;
    try {
      status.textContent = 'Preparing the file…';
      downloadBase64(await opts.buildBase64(''), opts.fileName(''));
      status.textContent = isProfile ? 'Saved. To use it on another device, open Your profile there and choose Restore from file.' : 'Saved to your downloads.';
      // an anonymous tally of downloads, a number and nothing else
      fetch('/api/counter', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'workbook' }) }).catch(() => {});
    } catch (e) {
      status.textContent = e.message;
    } finally { download.disabled = false; }
  });
  return el('div', { class: 'card export' }, [
    el('h3', { style: 'margin-top:0' }, opts.title),
    el('p', { class: 'muted' }, opts.intro),
    el('div', { class: 'btn-row' }, [download]),
    status,
  ]);
}
