/**
 * firebaseService.ts
 *
 * All Firebase access lives here — Firestore for the atomic sequence
 * counter, the saved quotation records, and template metadata. Nothing
 * else in the app should import "firebase/*" directly, so this is the one
 * place that changes if the backend ever moves.
 *
 * Firebase Storage requires the paid Blaze plan, so it's deliberately not
 * used: letterhead PDFs ship as static files in the Vite app's /public
 * folder instead (see pdfGenerator.ts). Firestore stays free on the Spark
 * plan, so template *metadata* (name + which local file it points to)
 * still lives there for easy management — only the file bytes moved.
 *
 * Requires these Vite env vars (e.g. in a .env.local file, never committed):
 *   VITE_FIREBASE_API_KEY
 *   VITE_FIREBASE_AUTH_DOMAIN
 *   VITE_FIREBASE_PROJECT_ID
 *   VITE_FIREBASE_MESSAGING_SENDER_ID
 *   VITE_FIREBASE_APP_ID
 *
 * Expected Firestore layout:
 *   quotationCounters/{fiscalYear}   -> { fiscalYear, lastSequence }
 *   quotations/{quotationId}         -> full Quotation record
 *   clients/{clientKey}              -> { name, gstin } — remembers each
 *                                        client's GSTIN so it can be
 *                                        offered as a starting point next
 *                                        time the same client is entered;
 *                                        always editable, never enforced.
 *   templates/{templateId}           -> { name, storagePath } — storagePath
 *                                        is a root-relative /public path,
 *                                        e.g. "/spe_kbl.pdf", not a Storage
 *                                        bucket path. Optional: if this
 *                                        collection is empty, fetchTemplates
 *                                        falls back to the three built-in
 *                                        templates (SPE/DPS/INF) so the app
 *                                        works with zero setup.
 */

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  runTransaction,
  setDoc,
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  type Firestore,
} from 'firebase/firestore';
import type { Quotation, Template } from './types';
import { SPE_TEMPLATE_PATH, SPE_DEFAULT_TERMS, SPE_DEFAULT_TERMS_COLOR } from './speTemplate';
import { DPS_TEMPLATE_PATH } from './dpsTemplate';
import { INF_TEMPLATE_PATH } from './infTemplate';
import {
  SPE_AMC_TEMPLATE_PATH,
  SESHADRIPURAM_TEMPLATE_PATH,
  AMC_DEFAULT_TERMS,
  AMC_DEFAULT_TERMS_COLOR,
} from './amcTemplate';

/** Thrown by every function in this module so the UI can show one message
 * shape regardless of which Firebase SDK internally failed. Uses the
 * standard ES2022 `cause` option (not a custom field) so `error.cause`
 * works the normal way and nothing here needs non-erasable TS syntax like
 * constructor parameter properties. */
export class QuotationServiceError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'QuotationServiceError';
  }
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
};


if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  // Fail loudly at startup rather than with a cryptic SDK error later.
  // eslint-disable-next-line no-console
  console.error(
    'Firebase config is missing. Check that VITE_FIREBASE_* env vars are set (see firebaseService.ts).',
  );
}

const firebaseApp: FirebaseApp = initializeApp(firebaseConfig);
export const db: Firestore = getFirestore(firebaseApp);

const COUNTERS_COLLECTION = 'quotationCounters';
const QUOTATIONS_COLLECTION = 'quotations';
const TEMPLATES_COLLECTION = 'templates';

/**
 * Derives the fiscal-year string (e.g. "26-27") for a given date.
 * The Indian fiscal year runs 1 April - 31 March, so any date in
 * Jan-Mar belongs to the fiscal year that started the previous April.
 */
export function getCurrentFiscalYear(referenceDate: Date = new Date()): string {
  const calendarYear = referenceDate.getFullYear();
  const isBeforeApril = referenceDate.getMonth() < 3; // 0 = Jan, 3 = Apr
  const startYear = isBeforeApril ? calendarYear - 1 : calendarYear;
  const endYear = startYear + 1;
  const twoDigits = (year: number) => `${year}`.slice(-2);
  return `${twoDigits(startYear)}-${twoDigits(endYear)}`;
}

/**
 * Atomically reserves and returns the next sequence number for a fiscal
 * year. The counter is shared across all prefixes on purpose — KBL, YL and
 * ANJ quotes draw from the same running number, they just wear different
 * prefixes — so this must go through a Firestore transaction to stay safe
 * under concurrent use.
 */
export async function getNextSequenceNumber(fiscalYear: string): Promise<number> {
  const counterRef = doc(db, COUNTERS_COLLECTION, fiscalYear);

  try {
    return await runTransaction(db, async (transaction) => {
      const counterSnap = await transaction.get(counterRef);
      const currentValue = counterSnap.exists()
        ? (counterSnap.data().lastSequence as number)
        : 0;
      const nextValue = currentValue + 1;
      transaction.set(counterRef, { fiscalYear, lastSequence: nextValue }, { merge: true });
      return nextValue;
    });
  } catch (error) {
    throw new QuotationServiceError(
      'Could not reserve a quotation number. Check your connection and try again.',
      error,
    );
  }
}

/** Persists the finished quotation record. Call this only after the sequence
 * number has been reserved, since the record's quoteNumber depends on it. */
export async function saveQuotation(quotation: Quotation): Promise<void> {
  try {
    await setDoc(doc(db, QUOTATIONS_COLLECTION, quotation.id), quotation);
  } catch (error) {
    throw new QuotationServiceError(
      'The quotation number was reserved, but saving the record failed. ' +
        `Please note number ${quotation.quoteNumber} and try again.`,
      error,
    );
  }
}

/**
 * Lists the most recently generated quotations, newest first, for the
 * History tab. Returns an empty list on failure rather than throwing — the
 * form itself must never be blocked by history being unavailable.
 */
export async function listRecentQuotations(maxCount = 50): Promise<Quotation[]> {
  try {
    const snapshot = await getDocs(
      query(collection(db, QUOTATIONS_COLLECTION), orderBy('createdAt', 'desc'), limit(maxCount)),
    );
    return snapshot.docs.map((quotationDoc) => quotationDoc.data() as Quotation);
  } catch {
    return [];
  }
}

/** Used only when the `templates` collection is empty — keeps the app usable
 * with zero Firestore setup, pointing straight at the files in /public. */
const FALLBACK_TEMPLATES: Template[] = [
  {
    id: 'spe',
    name: 'SPE template',
    storagePath: SPE_TEMPLATE_PATH,
    downloadUrl: SPE_TEMPLATE_PATH,
    numberingMode: 'sequential',
    defaultTerms: SPE_DEFAULT_TERMS,
    defaultTermsColor: SPE_DEFAULT_TERMS_COLOR,
  },
  {
    id: 'spe-amc',
    name: 'SPE AMC',
    storagePath: SPE_AMC_TEMPLATE_PATH,
    downloadUrl: SPE_AMC_TEMPLATE_PATH,
    numberingMode: 'sequential',
    defaultTerms: AMC_DEFAULT_TERMS,
    defaultTermsColor: AMC_DEFAULT_TERMS_COLOR,
  },
  {
    id: 'seshadripuram',
    name: 'Seshadripuram',
    storagePath: SESHADRIPURAM_TEMPLATE_PATH,
    downloadUrl: SESHADRIPURAM_TEMPLATE_PATH,
    numberingMode: 'sequential',
    defaultTerms: AMC_DEFAULT_TERMS,
    defaultTermsColor: AMC_DEFAULT_TERMS_COLOR,
  },
  {
    id: 'dps',
    name: 'Diamond Power Solutions',
    storagePath: DPS_TEMPLATE_PATH,
    downloadUrl: DPS_TEMPLATE_PATH,
    numberingMode: 'fixed',
    fixedPrefix: 'DPS',
    fixedSuffix: 'QTN',
  },
  {
    id: 'inf',
    name: 'Info Diesel & Electricals',
    storagePath: INF_TEMPLATE_PATH,
    downloadUrl: INF_TEMPLATE_PATH,
    numberingMode: 'fixed',
    fixedPrefix: 'INF',
    fixedSuffix: 'QTN',
  },
];

/**
 * Loads every available letterhead template. Metadata (name + which local
 * file it points to) comes from Firestore; `storagePath` is a root-relative
 * path into the app's /public folder (e.g. "/spe_kbl.pdf"), so it's already
 * directly fetchable as-is — no Storage download-URL resolution needed.
 */
export async function fetchTemplates(): Promise<Template[]> {
  try {
    const snapshot = await getDocs(collection(db, TEMPLATES_COLLECTION));
    if (snapshot.empty) return FALLBACK_TEMPLATES;

    return snapshot.docs.map((templateDoc) => {
      const data = templateDoc.data() as {
        name: string;
        storagePath: string;
        numberingMode?: 'sequential' | 'fixed';
        fixedPrefix?: string;
        fixedSuffix?: string;
        defaultTerms?: string[];
        defaultTermsColor?: string;
        /** @deprecated replaced by numberingMode — read for backward compatibility only. */
        usesSequentialNumbering?: boolean;
      };
      // Defaults to 'sequential' (the original behavior) for any template
      // doc created before numberingMode existed, so existing setups don't
      // silently lose sequential numbering. A doc that still only has the
      // old usesSequentialNumbering field is honored too.
      const numberingMode =
        data.numberingMode ?? (data.usesSequentialNumbering === false ? 'fixed' : 'sequential');
      const template: Template = {
        id: templateDoc.id,
        name: data.name,
        storagePath: data.storagePath,
        downloadUrl: data.storagePath,
        numberingMode,
        fixedPrefix: data.fixedPrefix,
        fixedSuffix: data.fixedSuffix,
        defaultTerms: data.defaultTerms,
        defaultTermsColor: data.defaultTermsColor,
      };
      return template;
    });
  } catch (error) {
    throw new QuotationServiceError(
      'Could not load letterhead templates. Check your connection and try again.',
      error,
    );
  }
}

const CLIENTS_COLLECTION = 'clients';

/** Turns a client name into a stable, Firestore-safe document id — lowercase,
 * trimmed, non-alphanumerics collapsed to single hyphens. Two names that
 * differ only in case or spacing ("Karnataka Bank Ltd" vs "karnataka  bank
 * ltd.") resolve to the same client record on purpose. */
function clientKey(clientName: string): string {
  const key = clientName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
  return key;
}

/**
 * Looks up the GSTIN a client used last time, so the form can offer it as a
 * starting point. Returns null on a miss (new client, or no GSTIN saved for
 * them yet) rather than throwing — this is a convenience default, not a
 * required step, so a lookup failure should never block the form.
 */
export async function findClientGstin(clientName: string): Promise<string | null> {
  const key = clientKey(clientName);
  if (!key) return null;
  try {
    const snap = await getDoc(doc(db, CLIENTS_COLLECTION, key));
    if (!snap.exists()) return null;
    const data = snap.data() as { gstin?: string };
    return data.gstin?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Remembers a client's GSTIN for next time. Called after a quotation is
 * generated, not while typing — a failure here shouldn't interrupt getting
 * the PDF, so it's silent on error like `findClientGstin`.
 */
export async function saveClientGstin(clientName: string, gstin: string): Promise<void> {
  const key = clientKey(clientName);
  if (!key || !gstin.trim()) return;
  try {
    await setDoc(
      doc(db, CLIENTS_COLLECTION, key),
      { name: clientName.trim(), gstin: gstin.trim() },
      { merge: true },
    );
  } catch {
    // Non-critical — the quotation itself already saved successfully.
  }
}

export interface RememberedClient {
  name: string;
  gstin: string;
}

/**
 * Lists every remembered client, for the Client Name autocomplete. Fetched
 * once and filtered locally as the user types rather than queried per
 * keystroke — simpler than a Firestore prefix query (which is
 * case-sensitive and needs its own index), and plenty fast at the scale a
 * single business's client list actually reaches. Returns an empty list on
 * failure rather than throwing — autocomplete is a convenience, not a
 * required step.
 */
export async function listClients(): Promise<RememberedClient[]> {
  try {
    const snapshot = await getDocs(collection(db, CLIENTS_COLLECTION));
    return snapshot.docs.map((clientDoc) => {
      const data = clientDoc.data() as { name?: string; gstin?: string };
      return { name: data.name ?? '', gstin: data.gstin ?? '' };
    });
  } catch {
    return [];
  }
}
