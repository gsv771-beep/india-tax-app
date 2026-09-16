/**
 * The "email me the workbook" card for a calculator. Small on purpose: the spec and the workbook
 * builder (calc-export.js, plus ExcelJS) load only when someone actually asks for the workbook.
 */
import { emailWorkbookCard } from './email-card.js';
import { safeFileName } from './xlsx-style.js';

const calcFileName = (prefix) => (who) => safeFileName(`taxcompass-${prefix}`, who);

const CARD_TEXT = {
  salary: { title: 'Email me this salary breakdown', intro: 'An Excel workbook with the CTC to in-hand working under both regimes, every figure you entered, and the assumptions.' },
  emi: { title: 'Email me this loan plan', intro: 'An Excel workbook with the EMI summary, the year-by-year schedule with your step-up and prepayments, every figure you entered, and the assumptions.' },
  sip: { title: 'Email me this projection', intro: 'An Excel workbook with the projection, the year-by-year growth, your lump sums, every figure you entered, and the assumptions.' },
  goal: { title: 'Email me this goal plan', intro: 'An Excel workbook with the SIP and one-time amounts that reach the goal, every figure you entered, and the assumptions.' },
  capgains: { title: 'Email me this working', intro: 'An Excel workbook with the gain computation, both options where they apply, every figure you entered, and the notes, so you can go through it with your CA.' },
  home: { title: 'Email me this home-buying plan', intro: 'An Excel workbook with the full cost of the property, the funding plan with EMI and the stage-by-stage payments and pre-EMI interest, every figure you entered, and the sources.' },
};

/**
 * The "email me the workbook" card for a calculator. `getLast()` returns the numbers the calculator
 * most recently computed (or null before anything is entered); the spec is built only when sending.
 */
export function calcExportCard(source, getLast) {
  const t = CARD_TEXT[source];
  let sheets = [];
  return emailWorkbookCard({
    title: t.title, intro: t.intro, source, fileName: calcFileName(source),
    buildBase64: async (who) => {
      const last = getLast();
      if (!last) throw new Error('Enter your figures first; there is nothing to send yet.');
      const { SPECS, buildCalcWorkbookBase64 } = await import('./calc-export.js');
      const spec = SPECS[source](last);
      sheets = [...spec.sheets.map((sh) => sh.name), 'Inputs', 'Notes'];
      return buildCalcWorkbookBase64(spec, who);
    },
    sheetNames: () => sheets,
  });
}
