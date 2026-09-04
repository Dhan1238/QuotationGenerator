/**
 * templates/infTemplate.ts
 *
 * Info Diesel & Electricals' letter — closer to SPE's bordered-table shape
 * than DPS's, but with its own column labels (SI.NO / DESCRIPTION / QTY /
 * UNIT RATE / TOTAL), an extra PAN line under the GSTIN, no Terms &
 * Conditions section, and a sign-off where "Partner." sits beside the
 * signature rather than below it. A "Working Site" note is flowing
 * content that follows the signature (it moved to page 2 in the longer of
 * the two reference examples), not a fixed page footer — drawn as an image
 * since that's how the original has it.
 *
 * Background: inf.pdf (masthead only, baked in). inf-signature.png is a
 * cleaned, transparent extraction of the actual signature from one of the
 * reference letters. inf-working-site.png is the closing note image.
 */

import type { PDFImage } from 'pdf-lib';
import type { Quotation } from './types';
import { PdfContext, fetchAssetBytes, formatAmount, formatDate, wrapText } from './pdfKit';

export const INF_TEMPLATE_PATH = '/inf.pdf';
const SIGNATURE_IMAGE_PATH = '/inf-signature.png';
const WORKING_SITE_IMAGE_PATH = '/inf-working-site.png';

const COMPANY_GSTIN = '29BDWPS9494N1ZT';
const COMPANY_PAN = 'BDWPS9494N';
const INTRO_PARAGRAPH = 'With reference to the telecom had with us, now we are enclosed our quotation as here below:';
const CLOSING_PARAGRAPH = 'Sir, we hope that our quoted prices are very reasonable and expecting your valuable orders.';

const CONTENT_LEFT = 72;
const CONTENT_RIGHT = 553;
const PAGE_CENTER_X = 306;
const TOP_CONTENT_Y = 637;
const RULE_BOTTOM_Y = 40;

const BODY_SIZE = 11;
const LINE_GAP = 13;
const PARA_GAP = 26;

const TABLE_LEFT = 78.5;
const TABLE_RIGHT = 552.5;
const TABLE_COLS = [78.5, 120.5, 339.5, 386.5, 457.5, 552.5] as const; // SI.NO | DESCRIPTION | QTY | UNIT RATE | TOTAL
const TABLE_ROW_HEIGHT = 22;
const TABLE_TEXT_SIZE = 9.5;
const TABLE_BOTTOM_LIMIT = 90;

const SIGNATURE_DISPLAY_WIDTH = 66;
const SIGNATURE_DISPLAY_HEIGHT = 22;
const WORKING_SITE_DISPLAY_WIDTH = 481;
const WORKING_SITE_DISPLAY_HEIGHT = 30;
const CLOSING_SECTION_HEIGHT = 155;
const WORKING_SITE_SECTION_HEIGHT = 30;

export async function renderInfQuotationPdf(quotation: Quotation): Promise<Uint8Array> {
  const [templateBytes, signatureBytes, workingSiteBytes] = await Promise.all([
    fetchAssetBytes(INF_TEMPLATE_PATH, 'the letterhead template'),
    fetchAssetBytes(SIGNATURE_IMAGE_PATH, 'the signature image'),
    fetchAssetBytes(WORKING_SITE_IMAGE_PATH, 'the working-site note image'),
  ]);

  const ctx = await PdfContext.create(templateBytes, TOP_CONTENT_Y, RULE_BOTTOM_Y);
  const signatureImage = await ctx.embedPng(signatureBytes, 'The signature image');
  const workingSiteImage = await ctx.embedPng(workingSiteBytes, 'The working-site note image');

  const drawTableHeaderRow = (y: number) => {
    const headers = ['SI.NO', 'DESCRIPTION', 'QTY', 'UNIT RATE', 'TOTAL'];
    headers.forEach((label, i) => {
      const colCenter = (TABLE_COLS[i] + TABLE_COLS[i + 1]) / 2;
      ctx.writeCentered(label, colCenter, y - 15, TABLE_TEXT_SIZE, true);
    });
  };

  const drawItemRow = (slNo: string, description: string, qtyText: string, rate: number, amount: number, y: number): number => {
    const descLines = wrapText(description, ctx.font, TABLE_TEXT_SIZE, TABLE_COLS[2] - TABLE_COLS[1] - 10);
    const rowHeight = Math.max(TABLE_ROW_HEIGHT, descLines.length * (TABLE_TEXT_SIZE + 3) + 10);
    const textY = y - 15;
    ctx.writeCentered(slNo, (TABLE_COLS[0] + TABLE_COLS[1]) / 2, textY, TABLE_TEXT_SIZE);
    descLines.forEach((line, i) => {
      ctx.writeCentered(line, (TABLE_COLS[1] + TABLE_COLS[2]) / 2, textY - i * (TABLE_TEXT_SIZE + 3), TABLE_TEXT_SIZE);
    });
    ctx.writeCentered(qtyText, (TABLE_COLS[2] + TABLE_COLS[3]) / 2, textY, TABLE_TEXT_SIZE);
    ctx.writeCentered(`${rate.toLocaleString('en-IN')}/-`, (TABLE_COLS[3] + TABLE_COLS[4]) / 2, textY, TABLE_TEXT_SIZE);
    ctx.writeRightAligned(formatAmount(amount), TABLE_COLS[5] - 5, textY, TABLE_TEXT_SIZE);
    return rowHeight;
  };

  const drawSummaryRow = (label: string, amount: number, y: number, bold = false) => {
    ctx.writeRightAligned(label, TABLE_COLS[2] - 8, y - 15, TABLE_TEXT_SIZE, bold);
    ctx.writeRightAligned(formatAmount(amount), TABLE_COLS[5] - 5, y - 15, TABLE_TEXT_SIZE, bold);
  };

  try {
    ctx.write(quotation.quoteNumber, CONTENT_LEFT, ctx.cursorY, BODY_SIZE);
    ctx.writeRightAligned(formatDate(quotation.date), CONTENT_RIGHT, ctx.cursorY, BODY_SIZE);
    ctx.cursorY -= 26;

    ctx.write(quotation.clientName, CONTENT_LEFT, ctx.cursorY, BODY_SIZE);
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
    ctx.cursorY -= PARA_GAP;

    const subjectText = `Sub: ${quotation.subject}`;
    const subjectWidth = ctx.boldFont.widthOfTextAtSize(subjectText, BODY_SIZE);
    ctx.writeCentered(subjectText, PAGE_CENTER_X, ctx.cursorY, BODY_SIZE, true);
    ctx.drawHorizontalLine(PAGE_CENTER_X - subjectWidth / 2, PAGE_CENTER_X + subjectWidth / 2, ctx.cursorY - 2);
    ctx.cursorY -= PARA_GAP;

    ctx.cursorY = ctx.writeParagraph(INTRO_PARAGRAPH, CONTENT_LEFT, ctx.cursorY, CONTENT_RIGHT - CONTENT_LEFT, BODY_SIZE);
    ctx.cursorY -= PARA_GAP - LINE_GAP;

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
      const qtyText = item.unit.trim() ? `${item.quantity} ${item.unit.trim()}` : String(item.quantity);
      const descLines = wrapText(item.description, ctx.font, TABLE_TEXT_SIZE, TABLE_COLS[2] - TABLE_COLS[1] - 10);
      const rowHeight = Math.max(TABLE_ROW_HEIGHT, descLines.length * (TABLE_TEXT_SIZE + 3) + 10);
      await ensureSpaceInsideTable(rowHeight);
      const usedHeight = drawItemRow(String(i + 1).padStart(2, '0'), item.description, qtyText, item.rate, item.total, ctx.cursorY);
      ctx.cursorY -= usedHeight;
      ctx.drawHorizontalLine(TABLE_LEFT, TABLE_RIGHT, ctx.cursorY);
    }

    await ensureSpaceInsideTable();
    drawSummaryRow('Sub Total', quotation.subtotal, ctx.cursorY, true);
    ctx.cursorY -= TABLE_ROW_HEIGHT;
    ctx.drawHorizontalLine(TABLE_LEFT, TABLE_RIGHT, ctx.cursorY);

    await ensureSpaceInsideTable();
    drawSummaryRow(`Add GST @${(quotation.taxRate * 100).toFixed(0)}%`, quotation.taxAmount, ctx.cursorY, true);
    ctx.cursorY -= TABLE_ROW_HEIGHT;
    ctx.drawHorizontalLine(TABLE_LEFT, TABLE_RIGHT, ctx.cursorY);

    const hasDeduction = deductionItems.length > 0;
    if (hasDeduction) {
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
    }

    await ensureSpaceInsideTable();
    drawSummaryRow('Grand Total', quotation.grandTotal, ctx.cursorY, true);
    ctx.cursorY -= TABLE_ROW_HEIGHT;
    ctx.drawHorizontalLine(TABLE_LEFT, TABLE_RIGHT, ctx.cursorY);

    for (const x of TABLE_COLS) ctx.drawVerticalLine(x, tableTopY, ctx.cursorY);
    ctx.cursorY -= PARA_GAP;

    await ctx.ensureSpace(CLOSING_SECTION_HEIGHT);

    ctx.write(`OUR GSTIN ${COMPANY_GSTIN}`, CONTENT_LEFT, ctx.cursorY, BODY_SIZE, true);
    ctx.cursorY -= LINE_GAP;
    ctx.write(`PAN ${COMPANY_PAN}`, CONTENT_LEFT, ctx.cursorY, BODY_SIZE, true);
    ctx.cursorY -= PARA_GAP;

    ctx.cursorY = ctx.writeParagraph(CLOSING_PARAGRAPH, CONTENT_LEFT, ctx.cursorY, CONTENT_RIGHT - CONTENT_LEFT, BODY_SIZE);
    ctx.cursorY -= PARA_GAP - LINE_GAP;

    ctx.write('Thanking you,', CONTENT_LEFT, ctx.cursorY, BODY_SIZE, true);
    ctx.cursorY -= LINE_GAP;
    ctx.write('Yours faithfully,', CONTENT_LEFT, ctx.cursorY, BODY_SIZE, true);
    ctx.cursorY -= LINE_GAP;
    ctx.write('For Info Diesel & Electricals,', CONTENT_LEFT, ctx.cursorY, BODY_SIZE, true);
    ctx.cursorY -= LINE_GAP;

    const imageTopY = ctx.cursorY;
    ctx.drawImage(signatureImage as PDFImage, CONTENT_LEFT, imageTopY - SIGNATURE_DISPLAY_HEIGHT, SIGNATURE_DISPLAY_WIDTH, SIGNATURE_DISPLAY_HEIGHT);
    ctx.write('Partner.', CONTENT_LEFT + SIGNATURE_DISPLAY_WIDTH + 8, imageTopY - SIGNATURE_DISPLAY_HEIGHT + 6, BODY_SIZE, true);
    ctx.cursorY = imageTopY - SIGNATURE_DISPLAY_HEIGHT - PARA_GAP;

    // --- "Working Site" note: flowing content, not a fixed footer — moves
    // to a new page with everything else if it doesn't fit (matches the
    // reference, where the longer example pushed it to page 2). ---
    await ctx.ensureSpace(WORKING_SITE_SECTION_HEIGHT);
    ctx.drawImage(
      workingSiteImage as PDFImage,
      PAGE_CENTER_X - WORKING_SITE_DISPLAY_WIDTH / 2,
      ctx.cursorY - WORKING_SITE_DISPLAY_HEIGHT,
      WORKING_SITE_DISPLAY_WIDTH,
      WORKING_SITE_DISPLAY_HEIGHT,
    );
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error('Something went wrong while laying out the PDF content.', { cause: error });
  }

  return ctx.save();
}