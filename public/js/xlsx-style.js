/**
 * Shared ExcelJS loading and styling helpers used by the budget and tax workbooks.
 * Works in the browser (loads vendor/exceljs.min.js on demand) and in Node (pass the ExcelJS module in).
 */

let excelPromise = null;
export function loadExcelJS() {
  if (typeof window !== 'undefined' && window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (!excelPromise) {
    excelPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/vendor/exceljs.min.js';
      s.onload = () => resolve(window.ExcelJS);
      s.onerror = () => reject(new Error('Could not load the spreadsheet library'));
      document.head.append(s);
    });
  }
  return excelPromise;
}

export const X = {
  green: 'FF14532D', greenSoft: 'FFE3F1E8', amber: 'FF6B4E16', amberSoft: 'FFFBF1DC', red: 'FF9B1C1C', redSoft: 'FFFDE8E8',
  ink: 'FF1C2321', muted: 'FF5C6763', grid: 'FFD9DED6', zebra: 'FFF6F7F4', white: 'FFFFFFFF',
  inr: '"₹"#,##0;[Red]-"₹"#,##0', pct: '0.0%', pct2: '0.00%',
};
const thin = { style: 'thin', color: { argb: X.grid } };
export const border = { top: thin, bottom: thin, left: thin, right: thin };
export const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

export function sheetTitle(ws, text, sub, span = 'D') {
  ws.mergeCells(`A1:${span}1`); ws.mergeCells(`A2:${span}2`);
  const t = ws.getCell('A1'); t.value = text; t.font = { name: 'Calibri', bold: true, size: 16, color: { argb: X.green } }; ws.getRow(1).height = 26;
  const s = ws.getCell('A2'); s.value = sub; s.font = { name: 'Calibri', italic: true, size: 10, color: { argb: X.muted } };
}

const LEFT_HEADERS = new Set(['Note', 'Name', 'Type', 'Category', 'Item', 'Line', 'Field', 'Deduction', 'Scheme', 'Notes']);
export function headerRow(ws, r, cols, argb = X.green) {
  const row = ws.getRow(r);
  cols.forEach((t, i) => {
    const c = row.getCell(i + 1);
    c.value = t; c.font = { bold: true, color: { argb: X.white } }; c.fill = fill(argb);
    c.alignment = { vertical: 'middle', horizontal: i === 0 || LEFT_HEADERS.has(t) ? 'left' : 'right', wrapText: true }; c.border = border;
  });
  row.height = 22;
  return row;
}

export function dataRow(ws, r, values, fmts = [], opts = {}) {
  const row = ws.getRow(r);
  values.forEach((val, i) => {
    const c = row.getCell(i + 1);
    c.value = val;
    if (fmts[i]) c.numFmt = fmts[i];
    c.border = border;
    c.alignment = { vertical: 'middle', horizontal: typeof val === 'number' ? 'right' : 'left', wrapText: opts.wrap || false };
    if (opts.zebra) c.fill = fill(X.zebra);
    if (opts.fillArgb) c.fill = fill(opts.fillArgb);
    if (opts.bold) c.font = { bold: true, color: { argb: opts.color || X.ink } };
    else if (opts.color) c.font = { color: { argb: opts.color } };
  });
  return row;
}

export function toBase64(buf) {
  if (typeof Buffer !== 'undefined') return Buffer.from(buf).toString('base64');
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function safeFileName(prefix, who) {
  const slug = String(who || '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return `${prefix}-${slug || 'workbook'}-${new Date().toISOString().slice(0, 10)}.xlsx`;
}
