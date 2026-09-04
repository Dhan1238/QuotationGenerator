/**
 * templates/dpsTemplate.ts
 *
 * Diamond Power Solutions' letter — structurally different from SPE's: no
 * "QUOTATION" title, no table header row (items are numbered inline in the
 * description column, "1.  EXIDE Battery"), no Terms & Conditions section,
 * a bold closing sentence, and a right-aligned sign-off naming the actual
 * signatory rather than a generic "Authorized signatory". Coordinates
 * measured off DPS_KBL.pdf.
 *
 * Background: dps.pdf (masthead + a faint "DP" watermark, both baked in —
 * no erasure needed, this letterhead has no pre-printed signature to hide).
 * dps-signature.png is a cleaned, transparent extraction of the actual
 * signature from that reference, drawn fresh after the closing paragraph.
 */

import type { PDFImage } from 'pdf-lib';
import type { Quotation } from './types';
import { PdfContext, fetchAssetBytes, formatAmount, formatDate, wrapText } from './pdfKit';

export const DPS_TEMPLATE_PATH = '/dps.pdf';
const SIGNATURE_IMAGE_PATH = '/dps-signature.png';

const COMPANY_GSTIN = '29AAHFD9804G1Z8';
const INTRO_PARAGRAPH = 'With reference to the above subject matter, now we are quoted the price as per below:';
const CLOSING_PARAGRAPH = 'Sir, we hope that our quoted prices are very reasonable and expecting your valuable orders.';
const SIGN_OFF_COMPANY_LINE = 'For Diamond Power Solutions';
const SIGNATORY_LINE = "Suresh.S ( Partner )";

const CONTENT_LEFT = 90;
const CONTENT_RIGHT = 488;
const PAGE_CENTER_X = 306;
const TOP_CONTENT_Y = 610;
const RULE_BOTTOM_Y = 50;

const BODY_SIZE = 11;
const LINE_GAP = 13;
const PARA_GAP = 26;

const TABLE_LEFT = 102.5;
const TABLE_RIGHT = 487.5;
const TABLE_COLS = [102.5, 279.5, 334.5, 399.5, 487.5] as const; // Description(+No.) | Qty | Rate | Amount
const TABLE_ROW_HEIGHT = 20;
const TABLE_TEXT_SIZE = 10;
const TABLE_BOTTOM_LIMIT = 80;

const SIGNATURE_DISPLAY_WIDTH = 70;
const SIGNATURE_DISPLAY_HEIGHT = 22;
const CLOSING_SECTION_HEIGHT = 150;

export async function renderDpsQuotationPdf(quotation: Quotation): Promise<Uint8Array> {
  const [templateBytes, signatureBytes] = await Promise.all([
    fetchAssetBytes(DPS_TEMPLATE_PATH, 'the letterhead template'),
    fetchAssetBytes(SIGNATURE_IMAGE_PATH, 'the signature image'),
  ]);

  const ctx = await PdfContext.create(templateBytes, TOP_CONTENT_Y, RULE_BOTTOM_Y);
  const signatureImage = await ctx.embedPng(signatureBytes, 'The signature image');

  const drawItemRow = (description: string, qtyText: string, rateText: string, amountText: string, y: number) => {
    const descLines = wrapText(description, ctx.font, TABLE_TEXT_SIZE, TABLE_COLS[1] - TABLE_COLS[0] - 16);
    ctx.write(descLines[0] ?? '', TABLE_COLS[0] + 8, y - 14, TABLE_TEXT_SIZE);
    ctx.writeCentered(qtyText, (TABLE_COLS[1] + TABLE_COLS[2]) / 2, y - 14, TABLE_TEXT_SIZE);
    ctx.writeCentered(rateText, (TABLE_COLS[2] + TABLE_COLS[3]) / 2, y - 14, TABLE_TEXT_SIZE);
    ctx.writeRightAligned(amountText, TABLE_COLS[4] - 5, y - 14, TABLE_TEXT_SIZE);
  };

  const drawSummaryRow = (label: string, amount: number, y: number, bold = false) => {
    ctx.writeRightAligned(label, TABLE_COLS[1] - 6, y - 14, TABLE_TEXT_SIZE, bold);
    ctx.writeRightAligned(formatAmount(amount), TABLE_COLS[4] - 5, y - 14, TABLE_TEXT_SIZE, bold);
  };

  try {
    ctx.write(quotation.quoteNumber, CONTENT_LEFT, ctx.cursorY, BODY_SIZE);
    ctx.writeRightAligned(formatDate(quotation.date), CONTENT_RIGHT, ctx.cursorY, BODY_SIZE);
    ctx.cursorY -= 26;

    ctx.write(quotation.clientName, CONTENT_LEFT, ctx.cursorY, BODY_SIZE, true);
    ctx.cursorY -= LINE_GAP;
    const addressLines = quotation.clientAddress.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of addressLines) {
      ctx.write(line, CONTENT_LEFT, ctx.cursorY, BODY_SIZE, true);
      ctx.cursorY -= LINE_GAP;
    }
    if (quotation.clientGstin.trim()) {
      ctx.write(`GSTIN ${quotation.clientGstin}`, CONTENT_LEFT, ctx.cursorY, BODY_SIZE, true);
      ctx.cursorY -= LINE_GAP;
    }
    ctx.cursorY -= PARA_GAP - LINE_GAP;

    ctx.write('Dear Sir,', CONTENT_LEFT, ctx.cursorY, BODY_SIZE);
    ctx.cursorY -= PARA_GAP;

    const subjectText = `Sub: ${quotation.subject}`;
    const subjectWidth = ctx.boldFont.widthOfTextAtSize(subjectText, BODY_SIZE);
    ctx.writeCentered(subjectText, PAGE_CENTER_X, ctx.cursorY, BODY_SIZE, true);
    ctx.drawHorizontalLine(PAGE_CENTER_X - subjectWidth / 2, PAGE_CENTER_X + subjectWidth / 2, ctx.cursorY - 2);
    ctx.cursorY -= LINE_GAP;

    ctx.cursorY = ctx.writeParagraph(INTRO_PARAGRAPH, CONTENT_LEFT, ctx.cursorY, CONTENT_RIGHT - CONTENT_LEFT, BODY_SIZE, 44);
    ctx.cursorY -= 4;

    const taxableItems = quotation.lineItems.filter((item) => item.total >= 0);
    const deductionItems = quotation.lineItems.filter((item) => item.total < 0);

    await ctx.ensureSpace(TABLE_ROW_HEIGHT * 2);
    let tableTopY = ctx.cursorY;
    ctx.drawHorizontalLine(TABLE_LEFT, TABLE_RIGHT, ctx.cursorY);

    const ensureSpaceInsideTable = async () => {
      if (ctx.cursorY - TABLE_ROW_HEIGHT < TABLE_BOTTOM_LIMIT) {
        for (const x of TABLE_COLS) ctx.drawVerticalLine(x, tableTopY, ctx.cursorY);
        await ctx.newPage();
        tableTopY = ctx.cursorY;
        ctx.drawHorizontalLine(TABLE_LEFT, TABLE_RIGHT, ctx.cursorY);
      }
    };

    for (let i = 0; i < taxableItems.length; i++) {
      await ensureSpaceInsideTable();
      const item = taxableItems[i];
      const qtyText = item.unit.trim() ? `${item.quantity} ${item.unit.trim()}` : String(item.quantity);
      const label = `${i + 1}.  ${item.description}`;
      drawItemRow(label, qtyText, formatAmount(item.rate), formatAmount(item.total), ctx.cursorY);
      ctx.cursorY -= TABLE_ROW_HEIGHT;
      ctx.drawHorizontalLine(TABLE_LEFT, TABLE_RIGHT, ctx.cursorY);
    }

    await ensureSpaceInsideTable();
    drawSummaryRow('Sub Total', quotation.subtotal, ctx.cursorY, true);
    ctx.cursorY -= TABLE_ROW_HEIGHT;
    ctx.drawHorizontalLine(TABLE_LEFT, TABLE_RIGHT, ctx.cursorY);

    await ensureSpaceInsideTable();
    drawSummaryRow(`GST@${(quotation.taxRate * 100).toFixed(0)}%`, quotation.taxAmount, ctx.cursorY, true);
    ctx.cursorY -= TABLE_ROW_HEIGHT;
    ctx.drawHorizontalLine(TABLE_LEFT, TABLE_RIGHT, ctx.cursorY);

    await ensureSpaceInsideTable();
    drawSummaryRow('Total', quotation.totalBeforeDeduction, ctx.cursorY, true);
    ctx.cursorY -= TABLE_ROW_HEIGHT;
    ctx.drawHorizontalLine(TABLE_LEFT, TABLE_RIGHT, ctx.cursorY);

    for (const deduction of deductionItems) {
      await ensureSpaceInsideTable();
      drawSummaryRow(`Less: ${deduction.description}`, deduction.total, ctx.cursorY, true);
      ctx.cursorY -= TABLE_ROW_HEIGHT;
      ctx.drawHorizontalLine(TABLE_LEFT, TABLE_RIGHT, ctx.cursorY);
    }

    await ensureSpaceInsideTable();
    drawSummaryRow('Grand Total', quotation.grandTotal, ctx.cursorY, true);
    ctx.cursorY -= TABLE_ROW_HEIGHT;
    ctx.drawHorizontalLine(TABLE_LEFT, TABLE_RIGHT, ctx.cursorY);

    for (const x of TABLE_COLS) ctx.drawVerticalLine(x, tableTopY, ctx.cursorY);
    ctx.cursorY -= PARA_GAP;

    await ctx.ensureSpace(CLOSING_SECTION_HEIGHT);

    ctx.write(`OUR GSTIN: ${COMPANY_GSTIN}`, CONTENT_LEFT, ctx.cursorY, BODY_SIZE, true);
    ctx.cursorY -= PARA_GAP;

    ctx.cursorY = ctx.writeParagraph(CLOSING_PARAGRAPH, CONTENT_LEFT, ctx.cursorY, CONTENT_RIGHT - CONTENT_LEFT, 10, 0, true);
    ctx.cursorY -= PARA_GAP;

    ctx.writeRightAligned("Your's faithfully", CONTENT_RIGHT, ctx.cursorY, 10, true);
    ctx.cursorY -= LINE_GAP;
    ctx.writeRightAligned(SIGN_OFF_COMPANY_LINE, CONTENT_RIGHT, ctx.cursorY, 10, true);
    ctx.cursorY -= LINE_GAP;

    const imageTopY = ctx.cursorY - 4;
    ctx.drawImage(
      signatureImage as PDFImage,
      CONTENT_RIGHT - SIGNATURE_DISPLAY_WIDTH,
      imageTopY - SIGNATURE_DISPLAY_HEIGHT,
      SIGNATURE_DISPLAY_WIDTH,
      SIGNATURE_DISPLAY_HEIGHT,
    );
    ctx.cursorY = imageTopY - SIGNATURE_DISPLAY_HEIGHT - LINE_GAP;

    ctx.writeRightAligned(SIGNATORY_LINE, CONTENT_RIGHT, ctx.cursorY, 10, true);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error('Something went wrong while laying out the PDF content.', { cause: error });
  }

  return ctx.save();
}
