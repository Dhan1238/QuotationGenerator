/**
 * pdfGenerator.ts
 *
 * Every template's actual layout lives in ./templates/*.ts — this file
 * just knows which renderer to call for a given template. Adding a fourth
 * letterhead means writing one new file under ./templates and registering
 * it in TEMPLATE_RENDERERS below; nothing else in the app needs to change.
 */

import type { Quotation } from './types';
import { SPE_TEMPLATE_PATH, renderSpeQuotationPdf } from './speTemplate';
import { DPS_TEMPLATE_PATH, renderDpsQuotationPdf } from './dpsTemplate';
import { INF_TEMPLATE_PATH, renderInfQuotationPdf } from './infTemplate';
import {
  SPE_AMC_TEMPLATE_PATH,
  SESHADRIPURAM_TEMPLATE_PATH,
  renderSpeAmcQuotationPdf,
  renderSeshadripuramQuotationPdf,
} from './amcTemplate';

export { downloadPdfBytes } from './pdfKit';

/** Kept for backwards compatibility with existing imports (e.g. the
 * zero-setup Firestore fallback) — this is SPE's path specifically. */
export const DEFAULT_TEMPLATE_PATH = SPE_TEMPLATE_PATH;

const TEMPLATE_RENDERERS: Record<string, (quotation: Quotation) => Promise<Uint8Array>> = {
  [SPE_TEMPLATE_PATH]: renderSpeQuotationPdf,
  [DPS_TEMPLATE_PATH]: renderDpsQuotationPdf,
  [INF_TEMPLATE_PATH]: renderInfQuotationPdf,
  [SPE_AMC_TEMPLATE_PATH]: renderSpeAmcQuotationPdf,
  [SESHADRIPURAM_TEMPLATE_PATH]: renderSeshadripuramQuotationPdf,
};

/**
 * Generates the final quotation PDF as raw bytes, ready to download.
 * `templateUrl` is the selected Template's `downloadUrl` — for a local
 * /public template that's the same as its path (e.g. "/spe_kbl.pdf"),
 * which is how it's matched to a renderer below.
 */
export async function generateQuotationPdf(quotation: Quotation, templateUrl: string): Promise<Uint8Array> {
  const renderer = TEMPLATE_RENDERERS[templateUrl];
  if (!renderer) {
    throw new Error(
      `No layout is registered for template "${templateUrl}". ` +
        'Add a renderer for it in pdfGenerator.ts (see the templates/ folder for examples).',
    );
  }
  return renderer(quotation);
}
