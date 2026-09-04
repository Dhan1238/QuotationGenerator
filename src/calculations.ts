/**
 * calculations.ts
 *
 * Pure, dependency-free money math. Kept separate from the form component so
 * it's trivially unit-testable and so pdfGenerator/firebaseService never
 * have to re-derive numbers the form already computed.
 *
 * Every intermediate value is rounded to 2 decimals immediately after it's
 * produced (rather than only at display time) so rounding error can't
 * accumulate across subtotal -> tax -> total -> grand total.
 *
 * Deduction handling: a line item with a negative total (e.g. "Old Battery
 * Buyback", qty 1, rate -1000) is a deduction, not a taxable sale — it must
 * come OFF the bill after GST, not reduce the taxable subtotal. Folding it
 * into the subtotal before tax (the obvious-looking approach) quietly
 * undercharges GST, since tax would then be computed on a smaller base than
 * what was actually sold. computeSubtotal/computeDeductionTotal split line
 * items on that sign so the rest of the pipeline can't get this wrong.
 */

import type { LineItem } from './types';

/** Rounds to 2 decimal places, correcting for classic binary floating-point drift
 * (e.g. 1.005 * 100 landing on 100.49999999999999 instead of 100.5). */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function computeLineTotal(rate: number, quantity: number): number {
  if (!Number.isFinite(rate) || !Number.isFinite(quantity)) return 0;
  return round2(rate * quantity);
}

/** Sum of taxable line items only (total >= 0) — deductions are excluded. */
export function computeSubtotal(items: LineItem[]): number {
  const sum = items.filter((item) => item.total >= 0).reduce((acc, item) => acc + item.total, 0);
  return round2(sum);
}

/** Sum of deduction line items only (total < 0). Returns zero or a negative number. */
export function computeDeductionTotal(items: LineItem[]): number {
  const sum = items.filter((item) => item.total < 0).reduce((acc, item) => acc + item.total, 0);
  return round2(sum);
}

export function computeTax(subtotal: number, taxRate: number): number {
  return round2(subtotal * taxRate);
}

/** Taxable subtotal plus GST — the bill amount before any deduction. */
export function computeTotalBeforeDeduction(subtotal: number, taxAmount: number): number {
  return round2(subtotal + taxAmount);
}

/** totalBeforeDeduction with the (already non-positive) deductionTotal applied. */
export function computeGrandTotal(totalBeforeDeduction: number, deductionTotal: number): number {
  return round2(totalBeforeDeduction + deductionTotal);
}

/** Formats a number for on-screen display as Indian Rupees, e.g. "₹1,23,456.78". */
export function formatCurrencyDisplay(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
