/**
 * templates/amcTemplate.ts
 *
 * Two variants of the same AMC (Annual Maintenance Contract) letter share
 * this one file because they really are the same letter — same content
 * structure, same wording, same 2-column "item / amount" table instead of
 * the multi-column tables the other templates use. They differ only in:
 *
 *  - SPE AMC: drawn on Swamy Power's A4 masthead+footer background, with
 *    the signature/stamp images drawn in.
 *  - Seshadripuram: a genuinely blank A4 page — no masthead, no footer, no
 *    signature or stamp images (the user explicitly doesn't want them for
 *    this one; likely because it's meant to be printed on physical
 *    pre-printed letterhead paper). "Authorized signatory." still appears
 *    as plain text either way — only the graphics are conditional.
 *
 * Both are A4 (596 x 842 pt), unlike the other SPE templates which are US
 * Letter — measured directly off S_P_E_AMC_Template.pdf / SPE_Seshadripuram
 * AMC_QTN.pdf.
 */

import type { PDFImage } from 'pdf-lib';
import type { Quotation } from './types';
import { PdfContext, fetchAssetBytes, formatAmount, formatDate, hexToRgb, wrapText } from './pdfKit';

export const SPE_AMC_TEMPLATE_PATH = `${import.meta.env.BASE_URL}spe_amc.pdf`;
export const SESHADRIPURAM_TEMPLATE_PATH = `${import.meta.env.BASE_URL}seshadripuram.pdf`;
const SIGNATURE_IMAGE_PATH = `${import.meta.env.BASE_URL}signature.png`;
const STAMP_IMAGE_PATH = `${import.meta.env.BASE_URL}stamp.png`;

const COMPANY_GSTIN = '29CPBPS6491F1ZE';
const COMPANY_PAN = 'CPBPS6491F';
const INTRO_PARAGRAPH =
  'With reference to the above subject matter, now we are quoted the price as per below:';
const CLOSING_PARAGRAPH =
  'We hope our offer is in line with your requirements. Meantime, further any queries please feel free to contact us.';
export const AMC_DEFAULT_TERMS = [
  'The above charges are LABOURS ONLY. Any materials/Spares required will be charged separately.',
  'We shall make 6 visits. & unlimited complaint calls.',
  'AMC Charges: 100% payment as advance to be paid along with contract.',
  'In the event that repairs of Engine/Alternator are required to be done at our Work shop, To & Fro transportation charges will be to your account.',
  'Major break down due to improper usage and overloading is chargeable.',
  'We will arrange lube oil, & filter kits from our side, that cost will be extra.',
  'A Copy of the Service Report duly signed by your officer and our Engineer will be given to you for your records.',
  'Our Contract period is 1 year from the date of taking AMC',
  'No list of spares which comes under AMC. Spare/materials will be chargeable basis, only labour charges free during AMC Period.',
];
export const AMC_DEFAULT_TERMS_COLOR = '#1a1a1a';

const CONTENT_LEFT = 54;
const CONTENT_RIGHT = 535;
const PAGE_CENTER_X = 298;

const BODY_SIZE = 10;
const LINE_GAP = 13;
const PARA_GAP = 26;

const TABLE_LEFT = 61.5;
const TABLE_RIGHT = 534.5;
const TABLE_MID = 382.5; // divides description (left) from amount (right)
const AMC_ROW_HEIGHT = 22;
const AMC_TEXT_SIZE = 11;
const GST_TEXT_SIZE = 9;

const SIGNATURE_DISPLAY_WIDTH = 74;
const SIGNATURE_DISPLAY_HEIGHT = 35;
const STAMP_DISPLAY_WIDTH = 72;
const STAMP_DISPLAY_HEIGHT = 58;

interface AmcVariant {
  templatePath: string;
  topContentY: number;
  ruleBottomY: number;
  drawSignatureImages: boolean;
}

const SPE_AMC_VARIANT: AmcVariant = {
  templatePath: SPE_AMC_TEMPLATE_PATH,
  topContentY: 744,
  ruleBottomY: 90,
  drawSignatureImages: true,
};

const SESHADRIPURAM_VARIANT: AmcVariant = {
  templatePath: SESHADRIPURAM_TEMPLATE_PATH,
  topContentY: 717,
  ruleBottomY: 30,
  drawSignatureImages: false,
};

async function renderAmcLetter(quotation: Quotation, variant: AmcVariant): Promise<Uint8Array> {
  const templateBytes = await fetchAssetBytes(variant.templatePath, 'the letterhead template');

  const ctx = await PdfContext.create(templateBytes, variant.topContentY, variant.ruleBottomY);
  let signatureImage: PDFImage | null = null;
  let stampImage: PDFImage | null = null;
  if (variant.drawSignatureImages) {
    const [signatureBytes, stampBytes] = await Promise.all([
      fetchAssetBytes(SIGNATURE_IMAGE_PATH, 'the signature image'),
      fetchAssetBytes(STAMP_IMAGE_PATH, 'the stamp image'),
    ]);
    signatureImage = await ctx.embedPng(signatureBytes, 'The signature image');
    stampImage = await ctx.embedPng(stampBytes, 'The stamp image');
  }

  const drawAmcRow = (label: string, amount: string, y: number, size: number, bold: boolean) => {
    const lines = wrapText(label, bold ? ctx.boldFont : ctx.font, size, TABLE_MID - TABLE_LEFT - 16);
    lines.forEach((line, i) => ctx.write(line, TABLE_LEFT + 8, y - (i + 1) * (size + 2), size, bold));
    ctx.writeRightAligned(amount, TABLE_RIGHT - 5, y - lines.length * (size + 2), size, bold);
    return lines.length * (size + 2) + 6;
  };

  try {
    ctx.writeCentered('QUOTATION', PAGE_CENTER_X, ctx.cursorY, 12, true);
    ctx.cursorY -= 26;

    ctx.write(quotation.quoteNumber, CONTENT_LEFT, ctx.cursorY, BODY_SIZE);
    ctx.writeRightAligned(formatDate(quotation.date), CONTENT_RIGHT, ctx.cursorY, BODY_SIZE);
    ctx.cursorY -= 26;

    ctx.write(quotation.clientName, CONTENT_LEFT, ctx.cursorY, 12, true);
    ctx.cursorY -= 15.5;
    const addressLines = quotation.clientAddress.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of addressLines) {
      ctx.write(line, CONTENT_LEFT, ctx.cursorY, 12, true);
      ctx.cursorY -= 15.5;
    }
    if (quotation.clientGstin.trim()) {
      const gstinText = `GSTIN: ${quotation.clientGstin}`;
      ctx.write(gstinText, CONTENT_LEFT, ctx.cursorY, BODY_SIZE + 1);
      const w = ctx.font.widthOfTextAtSize(gstinText, BODY_SIZE + 1);
      ctx.drawHorizontalLine(CONTENT_LEFT, CONTENT_LEFT + w, ctx.cursorY - 1.5);
      ctx.cursorY -= LINE_GAP;
    }
    ctx.cursorY -= PARA_GAP - LINE_GAP;

    ctx.write('Dear Sir,', CONTENT_LEFT, ctx.cursorY, BODY_SIZE);
    ctx.cursorY -= LINE_GAP;

    const subjectText = `Sub: ${quotation.subject}`;
    const subjectWidth = ctx.boldFont.widthOfTextAtSize(subjectText, BODY_SIZE);
    ctx.writeCentered(subjectText, PAGE_CENTER_X, ctx.cursorY, BODY_SIZE, true);
    ctx.drawHorizontalLine(PAGE_CENTER_X - subjectWidth / 2, PAGE_CENTER_X + subjectWidth / 2, ctx.cursorY - 2);
    ctx.cursorY -= PARA_GAP;

    ctx.cursorY = ctx.writeParagraph(INTRO_PARAGRAPH, CONTENT_LEFT, ctx.cursorY, CONTENT_RIGHT - CONTENT_LEFT, BODY_SIZE);
    ctx.cursorY -= PARA_GAP - LINE_GAP;

    // --- AMC table: each taxable item as its own bold row, then GST, then
    // Total (and Grand Total / deduction rows only if a deduction exists) ---
    const taxableItems = quotation.lineItems.filter((item) => item.total >= 0);
    const deductionItems = quotation.lineItems.filter((item) => item.total < 0);

    let tableTopY = ctx.cursorY;
    ctx.drawHorizontalLine(TABLE_LEFT, TABLE_RIGHT, ctx.cursorY);

    const closeTableBorders = () => {
      ctx.drawVerticalLine(TABLE_LEFT, tableTopY, ctx.cursorY);
      ctx.drawVerticalLine(TABLE_MID, tableTopY, ctx.cursorY);
      ctx.drawVerticalLine(TABLE_RIGHT, tableTopY, ctx.cursorY);
    };

    const ensureRowSpace = async (rowHeight: number) => {
      if (ctx.cursorY - rowHeight < ctx.ruleBottomY) {
        closeTableBorders();
        await ctx.newPage();
        tableTopY = ctx.cursorY;
        ctx.drawHorizontalLine(TABLE_LEFT, TABLE_RIGHT, ctx.cursorY);
      }
    };

    for (const item of taxableItems) {
      const label = item.unit.trim() ? `${item.description} (${item.quantity} ${item.unit.trim()})` : item.description;
      await ensureRowSpace(AMC_ROW_HEIGHT);
      const used = drawAmcRow(label, formatAmount(item.total), ctx.cursorY, AMC_TEXT_SIZE, true);
      ctx.cursorY -= Math.max(AMC_ROW_HEIGHT, used);
      ctx.drawHorizontalLine(TABLE_LEFT, TABLE_RIGHT, ctx.cursorY);
    }

    await ensureRowSpace(AMC_ROW_HEIGHT);
    drawAmcRow(`Add GST @ ${(quotation.taxRate * 100).toFixed(0)}%`, formatAmount(quotation.taxAmount), ctx.cursorY, GST_TEXT_SIZE, false);
    ctx.cursorY -= AMC_ROW_HEIGHT;
    ctx.drawHorizontalLine(TABLE_LEFT, TABLE_RIGHT, ctx.cursorY);

    const hasDeduction = deductionItems.length > 0;
    await ensureRowSpace(AMC_ROW_HEIGHT);
    drawAmcRow('Total', formatAmount(quotation.totalBeforeDeduction), ctx.cursorY, AMC_TEXT_SIZE, true);
    ctx.cursorY -= AMC_ROW_HEIGHT;
    ctx.drawHorizontalLine(TABLE_LEFT, TABLE_RIGHT, ctx.cursorY);

    if (hasDeduction) {
      for (const deduction of deductionItems) {
        await ensureRowSpace(AMC_ROW_HEIGHT);
        drawAmcRow(`Less: ${deduction.description}`, formatAmount(deduction.total), ctx.cursorY, GST_TEXT_SIZE, false);
        ctx.cursorY -= AMC_ROW_HEIGHT;
        ctx.drawHorizontalLine(TABLE_LEFT, TABLE_RIGHT, ctx.cursorY);
      }
      await ensureRowSpace(AMC_ROW_HEIGHT);
      drawAmcRow('Grand Total', formatAmount(quotation.grandTotal), ctx.cursorY, AMC_TEXT_SIZE, true);
      ctx.cursorY -= AMC_ROW_HEIGHT;
      ctx.drawHorizontalLine(TABLE_LEFT, TABLE_RIGHT, ctx.cursorY);
    }

    closeTableBorders();
    ctx.cursorY -= PARA_GAP;

    await ctx.ensureSpace(40);
    const terms = quotation.termsAndConditions?.length ? quotation.termsAndConditions : AMC_DEFAULT_TERMS;
    const termsColor = hexToRgb(quotation.termsColor || AMC_DEFAULT_TERMS_COLOR);
    ctx.write('TERMS & CONDITIONS:', CONTENT_LEFT, ctx.cursorY, BODY_SIZE, true);
    {
      const w = ctx.boldFont.widthOfTextAtSize('TERMS & CONDITIONS:', BODY_SIZE);
      ctx.drawHorizontalLine(CONTENT_LEFT, CONTENT_LEFT + w, ctx.cursorY - 1.5);
    }
    ctx.cursorY -= LINE_GAP + 4;

    for (let i = 0; i < terms.length; i++) {
      const term = terms[i];
      const numberLabel = `${i + 1}.`;
      const termIndent = 18;
      const lines = wrapText(term, ctx.font, GST_TEXT_SIZE, CONTENT_RIGHT - CONTENT_LEFT - termIndent);
      await ctx.ensureSpace(lines.length * (GST_TEXT_SIZE + 2) + 3);
      ctx.write(numberLabel, CONTENT_LEFT + 4, ctx.cursorY, GST_TEXT_SIZE, false, termsColor);
      lines.forEach((line, li) => {
        ctx.write(line, CONTENT_LEFT + termIndent, ctx.cursorY - li * (GST_TEXT_SIZE + 2), GST_TEXT_SIZE, false, termsColor);
      });
      ctx.cursorY -= lines.length * (GST_TEXT_SIZE + 2) + 3;
    }
    ctx.cursorY -= PARA_GAP - LINE_GAP;

    const gstinLine = `OUR GSTIN NO. ${COMPANY_GSTIN}`;
    const panLine = `OUR PAN NO. ${COMPANY_PAN}`;
    const closingLines = wrapText(CLOSING_PARAGRAPH, ctx.font, BODY_SIZE, CONTENT_RIGHT - CONTENT_LEFT);
    // Mirrors the exact descent the drawing code below produces, down to
    // the "Authorized signatory." line (the true lowest content — the
    // signature/stamp images sit above it). +10 is a small margin for
    // font descenders rather than a guess: see pdfGenerator test notes.
    const signOffBlockHeight =
      LINE_GAP + // gstin -> pan
      PARA_GAP + // pan -> closing paragraph
      closingLines.length * (BODY_SIZE + 2) + // writeParagraph's actual line pitch
      (PARA_GAP - LINE_GAP) + // closing -> "Thanking you,"
      LINE_GAP * 2 + // Thanking you, / Yours truly,
      Math.max(SIGNATURE_DISPLAY_HEIGHT, STAMP_DISPLAY_HEIGHT) +
      LINE_GAP + // image bottom -> "Authorized signatory."
      10;
    await ctx.ensureSpace(signOffBlockHeight);

    ctx.write(gstinLine, CONTENT_LEFT, ctx.cursorY, BODY_SIZE, true);
    ctx.drawHorizontalLine(CONTENT_LEFT, CONTENT_LEFT + ctx.boldFont.widthOfTextAtSize(gstinLine, BODY_SIZE), ctx.cursorY - 1.5);
    ctx.cursorY -= LINE_GAP;
    ctx.write(panLine, CONTENT_LEFT, ctx.cursorY, BODY_SIZE, true);
    ctx.drawHorizontalLine(CONTENT_LEFT, CONTENT_LEFT + ctx.boldFont.widthOfTextAtSize(panLine, BODY_SIZE), ctx.cursorY - 1.5);
    ctx.cursorY -= PARA_GAP;

    ctx.cursorY = ctx.writeParagraph(CLOSING_PARAGRAPH, CONTENT_LEFT, ctx.cursorY, CONTENT_RIGHT - CONTENT_LEFT, BODY_SIZE);
    ctx.cursorY -= PARA_GAP - LINE_GAP;

    ctx.write('Thanking you,', CONTENT_LEFT, ctx.cursorY, BODY_SIZE);
    ctx.cursorY -= LINE_GAP;
    ctx.write('Yours truly,', CONTENT_LEFT, ctx.cursorY, BODY_SIZE);
    ctx.cursorY -= LINE_GAP;

    if (variant.drawSignatureImages && signatureImage && stampImage) {
      const signOffTopY = ctx.cursorY;
      const imageBottomY = signOffTopY - Math.max(SIGNATURE_DISPLAY_HEIGHT, STAMP_DISPLAY_HEIGHT);
      ctx.drawImage(signatureImage, CONTENT_LEFT, imageBottomY, SIGNATURE_DISPLAY_WIDTH, SIGNATURE_DISPLAY_HEIGHT);
      ctx.drawImage(stampImage, CONTENT_LEFT + 210, imageBottomY, STAMP_DISPLAY_WIDTH, STAMP_DISPLAY_HEIGHT);
      ctx.cursorY = imageBottomY - LINE_GAP;
    } else {
      ctx.cursorY -= LINE_GAP;
    }

    ctx.write('Authorized signatory.', CONTENT_LEFT, ctx.cursorY, BODY_SIZE);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error('Something went wrong while laying out the PDF content.', { cause: error });
  }

  return ctx.save();
}

export async function renderSpeAmcQuotationPdf(quotation: Quotation): Promise<Uint8Array> {
  return renderAmcLetter(quotation, SPE_AMC_VARIANT);
}

export async function renderSeshadripuramQuotationPdf(quotation: Quotation): Promise<Uint8Array> {
  return renderAmcLetter(quotation, SESHADRIPURAM_VARIANT);
}
