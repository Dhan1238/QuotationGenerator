/**
 * pdfKit.ts
 *
 * Shared, template-agnostic PDF drawing primitives. Every per-template
 * layout module (see ./templates/*) is built on top of this — it owns
 * nothing about what SPE, DPS, or INF's letters actually say, only how to
 * fetch assets, wrap text, format numbers, and draw onto a paginated
 * letterhead. Keeping this generic is what makes adding a fourth template
 * later a matter of writing one new file, not touching this one.
 */

import { PDFDocument, StandardFonts, rgb, type Color, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Fetches raw bytes via a basic browser `fetch()`. Works identically for a
 * root-relative /public path (e.g. "/spe_kbl.pdf") or a full remote URL. */
export async function fetchAssetBytes(url: string, label: string): Promise<ArrayBuffer> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`Could not reach ${label} at "${url}". Check your connection.`, { cause: error });
  }
  if (!response.ok) {
    throw new Error(
      `${label} "${url}" could not be loaded (status ${response.status}). ` +
        'If this is a local file, confirm it sits directly in the /public folder and the filename matches exactly.',
    );
  }
  return response.arrayBuffer();
}

/** Greedy word-wrap using the font's real glyph widths, so text never overruns a column. */
export function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = candidate;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

export function formatNumber(value: number): string {
  return value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Always shows a positive magnitude with a "Rs." prefix — callers decide
 * separately (e.g. a "Less:" label) whether the amount represents a deduction. */
export function formatAmount(value: number): string {
  return `Rs. ${formatNumber(Math.abs(value))}`;
}

export function formatDate(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/** Converts a "#rrggbb" (or "#rgb") hex string into a pdf-lib Color.
 * Falls back to near-black on anything that doesn't parse, so a malformed
 * or missing color never breaks a render — it just looks like the default. */
export function hexToRgb(hex: string): Color {
  const match = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return rgb(0.1, 0.1, 0.1);
  let value = match[1];
  if (value.length === 3) {
    value = value.split('').map((ch) => ch + ch).join('');
  }
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

/**
 * Owns the paginated drawing surface: which page is current, where the
 * cursor is, and how to start a fresh letterhead page when content runs
 * out of room. A template's layout module creates one of these per PDF and
 * calls its drawing methods — it never touches pdf-lib directly.
 */
export class PdfContext {
  readonly outputDoc: PDFDocument;
  readonly font: PDFFont;
  readonly boldFont: PDFFont;
  page: PDFPage;
  cursorY: number;

  private readonly masterDoc: PDFDocument;
  private readonly eraseRegions: Rect[];
  private readonly topContentY: number;
  readonly ruleBottomY: number;

  private constructor(
    outputDoc: PDFDocument,
    font: PDFFont,
    boldFont: PDFFont,
    masterDoc: PDFDocument,
    eraseRegions: Rect[],
    topContentY: number,
    ruleBottomY: number,
    firstPage: PDFPage,
  ) {
    this.outputDoc = outputDoc;
    this.font = font;
    this.boldFont = boldFont;
    this.masterDoc = masterDoc;
    this.eraseRegions = eraseRegions;
    this.topContentY = topContentY;
    this.ruleBottomY = ruleBottomY;
    this.page = firstPage;
    this.cursorY = topContentY;
  }

  /**
   * Loads the template, embeds the fonts, and returns a context with its
   * first letterhead page already added and the cursor at the top.
   */
  static async create(
    templateBytes: ArrayBuffer,
    topContentY: number,
    ruleBottomY: number,
    eraseRegions: Rect[] = [],
  ): Promise<PdfContext> {
    let masterDoc: PDFDocument;
    try {
      masterDoc = await PDFDocument.load(templateBytes);
    } catch (error) {
      throw new Error('The letterhead template file is not a valid PDF.', { cause: error });
    }
    if (masterDoc.getPageCount() < 1) {
      throw new Error('The letterhead template has no pages.');
    }

    const outputDoc = await PDFDocument.create();
    const font = await outputDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await outputDoc.embedFont(StandardFonts.HelveticaBold);

    const ctx = new PdfContext(outputDoc, font, boldFont, masterDoc, eraseRegions, topContentY, ruleBottomY, null as unknown as PDFPage);
    ctx.page = await ctx.addLetterheadPage();
    ctx.cursorY = topContentY;
    return ctx;
  }

  /** Copies a fresh letterhead page from the master template, painting over
   * any regions this template needs hidden (e.g. a pre-printed signature). */
  private async addLetterheadPage(): Promise<PDFPage> {
    const [copiedPage] = await this.outputDoc.copyPages(this.masterDoc, [0]);
    const newPage = this.outputDoc.addPage(copiedPage);
    for (const region of this.eraseRegions) {
      newPage.drawRectangle({
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
        color: rgb(1, 1, 1),
      });
    }
    return newPage;
  }

  /** Starts a new letterhead page and resets the cursor to the top. */
  async newPage(): Promise<void> {
    this.page = await this.addLetterheadPage();
    this.cursorY = this.topContentY;
  }

  /** If drawing `heightNeeded` more points would cross the safe bottom
   * margin, starts a fresh page first. */
  async ensureSpace(heightNeeded: number): Promise<void> {
    if (this.cursorY - heightNeeded < this.ruleBottomY) {
      await this.newPage();
    }
  }

  async embedPng(bytes: ArrayBuffer, label: string): Promise<PDFImage> {
    try {
      return await this.outputDoc.embedPng(bytes);
    } catch (error) {
      throw new Error(`${label} is not a valid PNG.`, { cause: error });
    }
  }

  write(text: string, x: number, y: number, size: number, bold = false, color?: Color): void {
    this.page.drawText(text, { x, y, size, font: bold ? this.boldFont : this.font, color: color ?? rgb(0.1, 0.1, 0.1) });
  }

  writeCentered(text: string, centerX: number, y: number, size: number, bold = false, color?: Color): void {
    const usedFont = bold ? this.boldFont : this.font;
    const width = usedFont.widthOfTextAtSize(text, size);
    this.write(text, centerX - width / 2, y, size, bold, color);
  }

  writeRightAligned(text: string, rightX: number, y: number, size: number, bold = false, color?: Color): void {
    const usedFont = bold ? this.boldFont : this.font;
    const width = usedFont.widthOfTextAtSize(text, size);
    this.write(text, rightX - width, y, size, bold, color);
  }

  /** Draws a left-aligned paragraph, wrapped to fit, returning the Y of the
   * next free line below it. Only the first line gets `firstLineIndent`. */
  writeParagraph(
    text: string,
    x: number,
    startY: number,
    maxWidth: number,
    size: number,
    firstLineIndent = 0,
    bold = false,
    color?: Color,
  ): number {
    const usedFont = bold ? this.boldFont : this.font;
    const lines = wrapText(text, usedFont, size, maxWidth - firstLineIndent);
    let y = startY;
    lines.forEach((line, index) => {
      this.write(line, x + (index === 0 ? firstLineIndent : 0), y, size, bold, color);
      y -= size + 2;
    });
    return y;
  }

  drawHorizontalLine(x1: number, x2: number, y: number, thickness = 0.75, color = rgb(0.3, 0.3, 0.3)): void {
    this.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
  }

  drawVerticalLine(x: number, y1: number, y2: number, thickness = 0.75, color = rgb(0.3, 0.3, 0.3)): void {
    this.page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness, color });
  }

  drawImage(image: PDFImage, x: number, y: number, width: number, height: number): void {
    this.page.drawImage(image, { x, y, width, height });
  }

  async save(): Promise<Uint8Array> {
    try {
      return await this.outputDoc.save();
    } catch (error) {
      throw new Error('Failed to finalize the generated PDF.', { cause: error });
    }
  }
}

/** Triggers a browser download of the generated PDF bytes. */
export function downloadPdfBytes(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
