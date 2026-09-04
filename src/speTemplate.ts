/**
 * templates/speTemplate.ts
 *
 * Swamy Power Enterprises' letter: title, bordered 5-column table (SL No /
 * Description / Qty / Rate / Amount), Terms & Conditions section, left-
 * aligned sign-off. Coordinates measured off SPE_KBL_Chandapura.pdf — see
 * git history / conversation notes if this ever needs re-measuring.
 *
 * The background PDF (spe_kbl.pdf) has its signature and stamp pre-printed
 * high on the page; this template erases that region and draws fresh
 * copies (signature.png / stamp.png) after the closing paragraph instead,
 * since the sign-off position moves with content length. All three files
 * need to sit in /public.
 */

import type { PDFImage } from 'pdf-lib';
import type { LineItem, Quotation } from './types';
import { PdfContext, fetchAssetBytes, formatAmount, formatDate, formatNumber, hexToRgb, wrapText, type Rect } from './pdfKit';

export const SPE_TEMPLATE_PATH = '/spe_kbl.pdf';
const SIGNATURE_IMAGE_PATH = '/signature.png';
const STAMP_IMAGE_PATH = '/stamp.png';

const COMPANY_GSTIN = '29CPBPS6491F1ZE';
export const SPE_DEFAULT_TERMS = ['Taxes: Included', 'Time required: 1 Week after confirmation'];
export const SPE_DEFAULT_TERMS_COLOR = '#1a1a1a';
const INTRO_PARAGRAPH =
  'With reference to your enquiry, we are pleased to submit our quotation as detailed below:';
const CLOSING_PARAGRAPH =
  'We hope our offer meets your requirements. For any queries, please feel free to contact us.';

// Covers spe_kbl.pdf's pre-printed signature (x 35-110, y 608-643) and stamp
// (x 440-530, y 596-668), with a small margin.
const ERASE_REGIONS: Rect[] = [{ x: 28, y: 588, width: 508, height: 90 }];

const CONTENT_LEFT = 36;
const CONTENT_RIGHT = 535;
const PAGE_CENTER_X = 306;
const TOP_CONTENT_Y = 692;
const RULE_BOTTOM_Y = 90;

const BODY_SIZE = 11;
const LINE_GAP = 13;
const PARA_GAP = 26;

const TABLE_LEFT = 36;
const TABLE_RIGHT = 535;
const TABLE_COLS = [36, 91, 314, 366, 445, 535] as const;
const TABLE_ROW_HEIGHT = 24;
const TABLE_TEXT_SIZE = 10;
const TABLE_BOTTOM_LIMIT = 110;

const SIGNATURE_DISPLAY_WIDTH = 74;
const SIGNATURE_DISPLAY_HEIGHT = 35;
const STAMP_DISPLAY_WIDTH = 72;
const STAMP_DISPLAY_HEIGHT = 58;

export async function renderSpeQuotationPdf(quotation: Quotation): Promise<Uint8Array> {
  const [templateBytes, signatureBytes, stampBytes] = await Promise.all([
    fetchAssetBytes(SPE_TEMPLATE_PATH, 'the letterhead template'),
    fetchAssetBytes(SIGNATURE_IMAGE_PATH, 'the signature image'),
    fetchAssetBytes(STAMP_IMAGE_PATH, 'the stamp image'),
  ]);

  const ctx = await PdfContext.create(templateBytes, TOP_CONTENT_Y, RULE_BOTTOM_Y, ERASE_REGIONS);
  const signatureImage = await ctx.embedPng(signatureBytes, 'The signature image');
  const stampImage = await ctx.embedPng(stampBytes, 'The stamp image');

  const drawTableHeaderRow = (y: number) => {
    const headers = ['SL No.', 'Description', 'Qty', 'Rate', 'Amount'];
    headers.forEach((label, i) => {
      const colCenter = (TABLE_COLS[i] + TABLE_COLS[i + 1]) / 2;
      ctx.writeCentered(label, colCenter, y - 16, TABLE_TEXT_SIZE, true);
    });
  };

  const drawItemRow = (item: LineItem, index: number, y: number): number => {
    const slNo = String(index + 1).padStart(2, '0');
    const qtyText = item.unit.trim() ? `${item.quantity} ${item.unit.trim()}` : String(item.quantity);
    const descLines = wrapText(item.description, ctx.font, TABLE_TEXT_SIZE, TABLE_COLS[2] - TABLE_COLS[1] - 10);
    const rowHeight = Math.max(TABLE_ROW_HEIGHT, descLines.length * (TABLE_TEXT_SIZE + 3) + 12);
    const textY = y - 16;
    ctx.writeCentered(slNo, (TABLE_COLS[0] + TABLE_COLS[1]) / 2, textY, TABLE_TEXT_SIZE);
    descLines.forEach((line, i) => {
      ctx.writeCentered(line, (TABLE_COLS[1] + TABLE_COLS[2]) / 2, textY - i * (TABLE_TEXT_SIZE + 3), TABLE_TEXT_SIZE);
    });
    ctx.writeCentered(qtyText, (TABLE_COLS[2] + TABLE_COLS[3]) / 2, textY, TABLE_TEXT_SIZE);
    ctx.writeCentered(formatNumber(item.rate), (TABLE_COLS[3] + TABLE_COLS[4]) / 2, textY, TABLE_TEXT_SIZE);
    ctx.writeRightAligned(formatAmount(item.total), TABLE_COLS[5] - 5, textY, TABLE_TEXT_SIZE);
    return rowHeight;
  };

  const drawSummaryRow = (label: string, amount: number, y: number, bold = false) => {
    ctx.writeRightAligned(label, TABLE_COLS[2] - 10, y - 16, TABLE_TEXT_SIZE, bold);
    ctx.writeRightAligned(formatAmount(amount), TABLE_COLS[5] - 5, y - 16, TABLE_TEXT_SIZE, bold);
  };

  try {
    ctx.writeCentered('QUOTATION', PAGE_CENTER_X, ctx.cursorY, 14, true);
    ctx.cursorY -= 28;

    ctx.write(quotation.quoteNumber, CONTENT_LEFT, ctx.cursorY, BODY_SIZE);
    ctx.writeRightAligned(formatDate(quotation.date), CONTENT_RIGHT, ctx.cursorY, BODY_SIZE);
    ctx.cursorY -= 26;

    ctx.write(quotation.clientName, CONTENT_LEFT, ctx.cursorY, BODY_SIZE, true);
    ctx.cursorY -= LINE_GAP;
    const addressLines = quotation.clientAddress.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of addressLines) {
      ctx.write(line, CONTENT_LEFT, ctx.cursorY, BODY_SIZE);
      ctx.cursorY -= LINE_GAP;
    }
    if (quotation.clientGstin.trim()) {
      ctx.write(`GSTIN ${quotation.clientGstin}`, CONTENT_LEFT, ctx.cursorY, BODY_SIZE);
      ctx.cursorY -= LINE_GAP;
    }
    ctx.cursorY -= PARA_GAP - LINE_GAP;

    ctx.write('Dear Sir,', CONTENT_LEFT, ctx.cursorY, BODY_SIZE);
    ctx.cursorY -= LINE_GAP;

    const subjectText = `Sub: ${quotation.subject}`;
    const subjectLines = wrapText(subjectText, ctx.boldFont, BODY_SIZE, CONTENT_RIGHT - CONTENT_LEFT);
    subjectLines.forEach((line, index) => {
      const lineWidth = ctx.boldFont.widthOfTextAtSize(line, BODY_SIZE);
      const lineY = ctx.cursorY - index * LINE_GAP;
      ctx.writeCentered(line, PAGE_CENTER_X, lineY, BODY_SIZE, true);
      ctx.drawHorizontalLine(PAGE_CENTER_X - lineWidth / 2, PAGE_CENTER_X + lineWidth / 2, lineY - 2);
    });
    ctx.cursorY -= (subjectLines.length - 1) * LINE_GAP;
    ctx.cursorY -= PARA_GAP;

    ctx.cursorY = ctx.writeParagraph(INTRO_PARAGRAPH, CONTENT_LEFT, ctx.cursorY, CONTENT_RIGHT - CONTENT_LEFT, BODY_SIZE, 48);

    const taxableItems = quotation.lineItems.filter((item) => item.total >= 0);
    const deductionItems = quotation.lineItems.filter((item) => item.total < 0);

    await ctx.ensureSpace(TABLE_ROW_HEIGHT * 2);
    let tableTopY = ctx.cursorY;
    ctx.drawHorizontalLine(TABLE_LEFT, TABLE_RIGHT, ctx.cursorY);
    drawTableHeaderRow(ctx.cursorY);
    ctx.cursorY -= TABLE_ROW_HEIGHT;
    ctx.drawHorizontalLine(TABLE_LEFT, TABLE_RIGHT, ctx.cursorY);

    const ensureSpaceInsideTable = async (neededHeight: number = TABLE_ROW_HEIGHT) => {
      if (ctx.cursorY - neededHeight < TABLE_BOTTOM_LIMIT) {
        for (const x of TABLE_COLS) ctx.drawVerticalLine(x, tableTopY, ctx.cursorY);
        await ctx.newPage();
        tableTopY = ctx.cursorY;
        ctx.drawHorizontalLine(TABLE_LEFT, TABLE_RIGHT, ctx.cursorY);
        drawTableHeaderRow(ctx.cursorY);
        ctx.cursorY -= TABLE_ROW_HEIGHT;
        ctx.drawHorizontalLine(TABLE_LEFT, TABLE_RIGHT, ctx.cursorY);
      }
    };

    for (let i = 0; i < taxableItems.length; i++) {
      const item = taxableItems[i];
      const descLines = wrapText(item.description, ctx.font, TABLE_TEXT_SIZE, TABLE_COLS[2] - TABLE_COLS[1] - 10);
      const rowHeight = Math.max(TABLE_ROW_HEIGHT, descLines.length * (TABLE_TEXT_SIZE + 3) + 12);
      await ensureSpaceInsideTable(rowHeight);
      const usedHeight = drawItemRow(item, i, ctx.cursorY);
      ctx.cursorY -= usedHeight;
      ctx.drawHorizontalLine(TABLE_LEFT, TABLE_RIGHT, ctx.cursorY);
    }

    await ensureSpaceInsideTable();
    drawSummaryRow('Sub Total', quotation.subtotal, ctx.cursorY, true);
    ctx.cursorY -= TABLE_ROW_HEIGHT;
    ctx.drawHorizontalLine(TABLE_LEFT, TABLE_RIGHT, ctx.cursorY);

    await ensureSpaceInsideTable();
    drawSummaryRow(`GST (${(quotation.taxRate * 100).toFixed(0)}%)`, quotation.taxAmount, ctx.cursorY, true);
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

    const terms = quotation.termsAndConditions?.length ? quotation.termsAndConditions : SPE_DEFAULT_TERMS;
    const termsColor = hexToRgb(quotation.termsColor || SPE_DEFAULT_TERMS_COLOR);
    const termsLineCount = terms.reduce(
      (count, term) => count + wrapText(term, ctx.font, BODY_SIZE, CONTENT_RIGHT - CONTENT_LEFT).length,
      0,
    );
    const closingParaLineCount = wrapText(CLOSING_PARAGRAPH, ctx.font, BODY_SIZE, CONTENT_RIGHT - CONTENT_LEFT).length;
    // Mirrors the exact descent the drawing code below produces — see the
    // matching comment in amcTemplate.ts for why this is measured, not
    // guessed, and why terms/closing need their own line counts now that
    // terms are user-editable and can no longer be assumed to be 2 lines.
    const closingSectionHeight =
      PARA_GAP + // GSTIN -> Terms header
      LINE_GAP + // Terms header -> first term line
      termsLineCount * LINE_GAP +
      (PARA_GAP - LINE_GAP) + // terms -> closing paragraph
      closingParaLineCount * LINE_GAP +
      (PARA_GAP - LINE_GAP) + // closing paragraph -> "Thank you."
      LINE_GAP * 2 + // "Thank you." / "Yours truly"
      Math.max(SIGNATURE_DISPLAY_HEIGHT, STAMP_DISPLAY_HEIGHT) +
      LINE_GAP + // image bottom -> "Authorized signatory"
      10;
    await ctx.ensureSpace(closingSectionHeight);

    ctx.write(`OUR GSTIN: ${COMPANY_GSTIN}`, CONTENT_LEFT, ctx.cursorY, BODY_SIZE);
    ctx.cursorY -= PARA_GAP;

    ctx.write('Terms & Conditions:', CONTENT_LEFT, ctx.cursorY, BODY_SIZE, true);
    ctx.cursorY -= LINE_GAP;
    for (const term of terms) {
      ctx.cursorY = ctx.writeParagraph(term, CONTENT_LEFT, ctx.cursorY, CONTENT_RIGHT - CONTENT_LEFT, BODY_SIZE, 0, false, termsColor);
    }
    ctx.cursorY -= PARA_GAP - LINE_GAP;

    ctx.cursorY = ctx.writeParagraph(CLOSING_PARAGRAPH, CONTENT_LEFT, ctx.cursorY, CONTENT_RIGHT - CONTENT_LEFT, BODY_SIZE);
    ctx.cursorY -= PARA_GAP - LINE_GAP;

    ctx.write('Thank you.', CONTENT_LEFT, ctx.cursorY, BODY_SIZE);
    ctx.cursorY -= LINE_GAP;
    ctx.write('Yours truly', CONTENT_LEFT, ctx.cursorY, BODY_SIZE);
    ctx.cursorY -= LINE_GAP;

    const signOffTopY = ctx.cursorY;
    const imageBottomY = signOffTopY - Math.max(SIGNATURE_DISPLAY_HEIGHT, STAMP_DISPLAY_HEIGHT);
    ctx.drawImage(signatureImage as PDFImage, CONTENT_LEFT, imageBottomY, SIGNATURE_DISPLAY_WIDTH, SIGNATURE_DISPLAY_HEIGHT);
    ctx.drawImage(stampImage as PDFImage, CONTENT_RIGHT - STAMP_DISPLAY_WIDTH, imageBottomY, STAMP_DISPLAY_WIDTH, STAMP_DISPLAY_HEIGHT);
    ctx.cursorY = imageBottomY - LINE_GAP;

    ctx.write('Authorized signatory', CONTENT_LEFT, ctx.cursorY, BODY_SIZE);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error('Something went wrong while laying out the PDF content.', { cause: error });
  }

  return ctx.save();
}
