/**
 * types.ts
 *
 * Central, explicit type definitions for the quotation builder.
 * Keeping these in one file means firebaseService, pdfGenerator, and
 * QuotationForm all agree on the exact same shape of data.
 */

/** A single row on the quotation (a product/service line). */
export interface LineItem {
  /** Client-generated unique id (crypto.randomUUID()) — used as the React key. */
  id: string;
  description: string;
  /**
   * Unit rate. Intentionally allowed to be negative so a row can represent a
   * deduction — e.g. "Old Battery Buyback". A negative total is what marks a
   * row as a deduction (see calculations.ts): it's excluded from the taxed
   * subtotal and instead subtracted after GST, matching how a buyback or
   * trade-in is actually accounted for on a GST quotation.
   */
  rate: number;
  quantity: number;
  /** e.g. "No", "LS" (lump sum), "Kg". Optional — leave blank for a plain count. */
  unit: string;
  /** Pre-computed rate * quantity, rounded to 2 decimals. Stored, not derived, so
   * the saved record and the generated PDF always show the exact same number. */
  total: number;
}

/** A fully-assembled quotation, ready to be saved and turned into a PDF. */
export interface Quotation {
  /** Firestore document id (also used as the PDF's internal reference). */
  id: string;
  /** The user-entered identifier, e.g. "KBL". Always stored upper-cased.
   * Only meaningful when the chosen template's usesSequentialNumbering is
   * true — otherwise empty, since quoteNumber was typed in full instead. */
  prefix: string;
  /** e.g. "26-27" — derived automatically from today's date. Empty when the
   * template doesn't use sequential numbering (see `prefix`). */
  fiscalYear: string;
  /** The atomically-reserved sequence number, e.g. 123. Zero when the
   * template doesn't use sequential numbering (see `prefix`). */
  sequenceNumber: number;
  /** The fully stitched, human-facing number, e.g. "KBL/26-27/123" for a
   * sequentially-numbered template — or, for a template that doesn't use
   * this app's numbering scheme, whatever the user typed in full. */
  quoteNumber: string;
  /** The core purpose of the quote, e.g. "Supply and Installation of Exide Battery Bank". */
  subject: string;
  clientName: string;
  /** Multi-line — branch, city, whatever the client's letterhead line needs. */
  clientAddress: string;
  clientGstin: string;
  /** ISO date string, yyyy-mm-dd. */
  date: string;
  lineItems: LineItem[];
  /** Sum of taxable (non-deduction) line item totals, rounded to 2 decimals. */
  subtotal: number;
  /** e.g. 0.18 for 18% GST. */
  taxRate: number;
  /** subtotal * taxRate, rounded to 2 decimals. */
  taxAmount: number;
  /** subtotal + taxAmount, before any deduction is applied. */
  totalBeforeDeduction: number;
  /** Sum of deduction line totals — zero or negative, rounded to 2 decimals. */
  deductionTotal: number;
  /** totalBeforeDeduction + deductionTotal, rounded to 2 decimals. */
  grandTotal: number;
  /** Which letterhead template (Template.id) this quotation was generated on. */
  templateId: string;
  /** ISO timestamp of when this quotation was generated — used to sort and
   * display the quotation history. Set once, at save time; never edited. */
  createdAt: string;
  /**
   * One entry per Terms & Conditions line/point, editable per quotation.
   * Optional so quotations saved before this feature existed still load and
   * render correctly — a renderer falls back to that template's default
   * terms when this is missing or empty. Only meaningful for templates
   * whose Template.defaultTerms is set (SPE, SPE AMC, Seshadripuram) —
   * ignored by templates with no Terms & Conditions section (DPS, INF).
   */
  termsAndConditions?: string[];
  /** Hex color (e.g. "#1a1a1a") for the Terms & Conditions text in the PDF.
   * Optional for the same backward-compatibility reason as termsAndConditions —
   * falls back to that template's default color, then to the same near-black
   * used for the rest of the letter if the template has no default either. */
  termsColor?: string;
}

/** A letterhead background template — a static PDF in the app's /public
 * folder, described by a small Firestore metadata record (see firebaseService.ts). */
export interface Template {
  /** Firestore document id for the template's metadata record. */
  id: string;
  /** Friendly name shown in the dropdown, e.g. "SPE template". */
  name: string;
  /** Root-relative path into /public, e.g. "/spe_kbl.pdf". */
  storagePath: string;
  /** For a local template this is identical to storagePath — kept as a
   * separate field so a future remote template can populate it differently. */
  downloadUrl: string;
  /**
   * How this template's quote number is produced:
   *  - 'sequential': prefix (user-typed) + fiscal year + a running number
   *    from a shared Firestore counter, e.g. "KBL/26-27/124". Used for
   *    Swamy Power Enterprises' own templates, which all share one counter.
   *  - 'fixed': always `${fixedPrefix}/${fiscalYear}/${fixedSuffix}`, e.g.
   *    "DPS/26-27/QTN" — no counter, nothing to type, only the fiscal year
   *    changes (automatically, every April). Used for other companies'
   *    templates that don't use this app's running-number scheme at all.
   */
  numberingMode: 'sequential' | 'fixed';
  /** Only meaningful when numberingMode is 'fixed'. */
  fixedPrefix?: string;
  /** Only meaningful when numberingMode is 'fixed'. */
  fixedSuffix?: string;
  /** Starting Terms & Conditions text for a new quotation on this template,
   * one entry per line/point — the form pre-fills and lets the user edit it
   * per quotation. Undefined (not an empty array) means this template has
   * no Terms & Conditions section at all (DPS, INF) — the form hides that
   * part entirely rather than showing an empty editor for it. */
  defaultTerms?: string[];
  /** Starting hex color for that text, e.g. "#1a1a1a". Only meaningful
   * alongside defaultTerms. */
  defaultTermsColor?: string;
}

export type ThemeMode = 'light' | 'dark';

/** Shape of the Firestore counter document used for atomic numbering. */
export interface CounterDoc {
  fiscalYear: string;
  lastSequence: number;
}
