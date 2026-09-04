/**
 * QuotationForm.tsx
 *
 * The entire user-facing screen: theme toggle, document details, dynamic
 * line items, live totals, and the Generate action. Deliberately a single
 * flat form with no live PDF preview — the PDF is only built (via
 * pdfGenerator.ts) at the moment the user clicks Generate.
 *
 * Requires Tailwind's `darkMode: 'class'` in tailwind.config.js.
 */

import { useEffect, useMemo, useState } from 'react';
import type { LineItem, Quotation, Template, ThemeMode } from './types';
import {
  computeDeductionTotal,
  computeGrandTotal,
  computeLineTotal,
  computeSubtotal,
  computeTax,
  computeTotalBeforeDeduction,
  formatCurrencyDisplay,
} from './calculations';
import {
  fetchTemplates,
  findClientGstin,
  getCurrentFiscalYear,
  getNextSequenceNumber,
  listClients,
  saveClientGstin,
  saveQuotation,
  type RememberedClient,
} from './firebaseService';
import { buildQuotationFileName, downloadPdfBytes, generateQuotationPdf } from './pdfGenerator';
import TemplateDropdown from './TemplateDropdown';
import QuotationHistory from './QuotationHistory';

const GST_RATE = 0.18;
const THEME_STORAGE_KEY = 'quotation-app-theme';

function createEmptyLineItem(): LineItem {
  return { id: crypto.randomUUID(), description: '', rate: 0, quantity: 1, unit: '', total: 0 };
}

function readInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Shared styles so every text input/select looks and behaves identically. */
const fieldClasses =
  'w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 ' +
  'px-4 py-3 text-base text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 ' +
  'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors';

/** Same as fieldClasses, but also strips the browser's native up/down
 * spinner buttons on <input type="number">, in both WebKit/Chromium and
 * Firefox — Tailwind has no built-in utility for this, so it's done via
 * arbitrary-property selectors. */
const numberFieldClasses =
  `${fieldClasses} [appearance:textfield] ` +
  '[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

const labelClasses = 'mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300';

export default function QuotationForm() {
  // ---------------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------------
  const [theme, setTheme] = useState<ThemeMode>(readInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = () => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));

  // ---------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------
  const [activeTab, setActiveTab] = useState<'form' | 'history'>('form');

  // ---------------------------------------------------------------------
  // Templates
  // ---------------------------------------------------------------------
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  const [termsText, setTermsText] = useState('');
  const [termsColor, setTermsColor] = useState('#1a1a1a');

  const applyFetchedTemplates = (fetched: Template[]) => {
    setTemplates(fetched);
    setSelectedTemplateId((current) => {
      if (current) return current;
      const first = fetched[0];
      if (first?.defaultTerms) {
        setTermsText(first.defaultTerms.join('\n'));
        setTermsColor(first.defaultTermsColor || '#1a1a1a');
      }
      return first?.id || '';
    });
    setTemplatesError(
      fetched.length === 0 ? 'No letterhead templates were found. Add one in Firebase to continue.' : null,
    );
  };

  // Mount-time load. Every state update here happens inside a .then()/
  // .catch()/.finally() callback rather than synchronously in the effect
  // body, since templatesLoading/templatesError already start at the right
  // values (true / null) for a first load — nothing needs setting before
  // the fetch actually resolves.
  useEffect(() => {
    let ignore = false;
    fetchTemplates()
      .then((fetched) => {
        if (!ignore) applyFetchedTemplates(fetched);
      })
      .catch((error: unknown) => {
        if (!ignore) setTemplatesError(error instanceof Error ? error.message : 'Could not load templates.');
      })
      .finally(() => {
        if (!ignore) setTemplatesLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  // Retry button handler — a normal event handler, not an effect, so
  // setting state synchronously up front (to show the loading state
  // immediately) is completely fine here.
  const retryLoadTemplates = () => {
    setTemplatesLoading(true);
    setTemplatesError(null);
    fetchTemplates()
      .then(applyFetchedTemplates)
      .catch((error: unknown) => {
        setTemplatesError(error instanceof Error ? error.message : 'Could not load templates.');
      })
      .finally(() => setTemplatesLoading(false));
  };

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId),
    [templates, selectedTemplateId],
  );
  // Defaults to 'sequential' (the app's original behavior) while templates
  // are still loading and selectedTemplate is momentarily unknown.
  const numberingMode = selectedTemplate?.numberingMode ?? 'sequential';

  // ---------------------------------------------------------------------
  // Terms & Conditions — only some templates have this section at all
  // (selectedTemplate.defaultTerms is undefined for DPS/INF, which never
  // show or use it). Resets to the newly-selected template's own defaults
  // when the user picks a different template from the dropdown — tied to
  // that explicit action (not a generic effect on selectedTemplate) so it
  // doesn't also fire, and clobber restored values, when History's "Load
  // into Form" sets the template programmatically.

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const nextTemplate = templates.find((template) => template.id === templateId);
    if (nextTemplate?.defaultTerms) {
      setTermsText(nextTemplate.defaultTerms.join('\n'));
      setTermsColor(nextTemplate.defaultTermsColor || '#1a1a1a');
    }
  };

  // ---------------------------------------------------------------------
  // Document detail fields
  // ---------------------------------------------------------------------
  const [prefix, setPrefix] = useState('');
  const [subject, setSubject] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [clientGstin, setClientGstin] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lineItems, setLineItems] = useState<LineItem[]>([createEmptyLineItem()]);
  // Rows added via "Add Deduction Row" — tracked only to show more helpful
  // placeholders on that row; the actual deduction mechanism is unchanged
  // (any row with a negative total is treated as a deduction).
  const [deductionRowIds, setDeductionRowIds] = useState<ReadonlySet<string>>(new Set());

  const [isGenerating, setIsGenerating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fiscalYear = useMemo(() => getCurrentFiscalYear(), []);
  const quoteNumberPreview = `${prefix.trim() || '____'}/${fiscalYear}/____`;
  const fixedQuoteNumber =
    numberingMode === 'fixed' && selectedTemplate
      ? `${selectedTemplate.fixedPrefix}/${fiscalYear}/${selectedTemplate.fixedSuffix}`
      : '';

  // Looks up a remembered GSTIN when the client name field loses focus, and
  // only fills it in if the field is still empty — an existing value (typed
  // by hand, or from a previous lookup) is never overwritten, so editing
  // always wins per the user's own input. The suggestion dropdown closes on
  // a short delay rather than immediately, so a click on a suggestion (see
  // onMouseDown below) has time to register before blur hides it.
  const handleClientNameBlur = () => {
    setTimeout(() => setShowClientSuggestions(false), 150);
    const name = clientName.trim();
    if (!name || clientGstin.trim()) return;
    findClientGstin(name).then((gstin) => {
      if (gstin) setClientGstin(gstin);
    });
  };

  // ---------------------------------------------------------------------
  // Client name autocomplete — fetched once (best-effort; an empty list
  // just means no suggestions show, never an error) and filtered locally
  // as the user types.
  // ---------------------------------------------------------------------
  const [knownClients, setKnownClients] = useState<RememberedClient[]>([]);
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);

  useEffect(() => {
    let ignore = false;
    listClients().then((clients) => {
      if (!ignore) setKnownClients(clients);
    });
    return () => {
      ignore = true;
    };
  }, []);

  const clientSuggestions = useMemo(() => {
    const query = clientName.trim().toLowerCase();
    if (!query) return [];
    return knownClients.filter((client) => client.name.toLowerCase().includes(query)).slice(0, 6);
  }, [knownClients, clientName]);

  const selectClientSuggestion = (client: RememberedClient) => {
    setClientName(client.name);
    if (client.gstin) setClientGstin(client.gstin);
    setShowClientSuggestions(false);
  };

  // ---------------------------------------------------------------------
  // Line item mutations
  // ---------------------------------------------------------------------
  const updateLineItem = (
    id: string,
    patch: Partial<Pick<LineItem, 'description' | 'rate' | 'quantity' | 'unit'>>,
  ) => {
    setLineItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const updated: LineItem = { ...item, ...patch };
        updated.total = computeLineTotal(updated.rate, updated.quantity);
        return updated;
      }),
    );
  };

  const addLineItem = () => setLineItems((prev) => [...prev, createEmptyLineItem()]);

  const addDeductionItem = () => {
    const newItem = createEmptyLineItem();
    setLineItems((prev) => [...prev, newItem]);
    setDeductionRowIds((prev) => new Set(prev).add(newItem.id));
  };

  const removeLineItem = (id: string) => {
    setLineItems((prev) => (prev.length > 1 ? prev.filter((item) => item.id !== id) : prev));
    setDeductionRowIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setRateDrafts((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  // ---------------------------------------------------------------------
  // Rate field: no comma-formatting while typing (that would fight the
  // cursor position), but a clean 0-suppressed raw value while focused and
  // an Indian-grouped display ("1,45,480") once the field is left. Keyed
  // by item id since each row edits independently.
  // ---------------------------------------------------------------------
  const [rateDrafts, setRateDrafts] = useState<Record<string, string>>({});

  const rateDisplayValue = (item: LineItem): string => {
    if (item.id in rateDrafts) return rateDrafts[item.id];
    return item.rate === 0 ? '' : item.rate.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  };

  const handleRateFocus = (item: LineItem) => {
    setRateDrafts((prev) => ({ ...prev, [item.id]: item.rate === 0 ? '' : String(item.rate) }));
  };

  const handleRateChange = (item: LineItem, rawInput: string) => {
    const isNegative = rawInput.trim().startsWith('-');
    let digits = rawInput.replace(/-/g, '').replace(/[^0-9.]/g, '');
    const firstDot = digits.indexOf('.');
    if (firstDot !== -1) {
      digits = digits.slice(0, firstDot + 1) + digits.slice(firstDot + 1).replace(/\./g, '');
    }
    const cleaned = (isNegative ? '-' : '') + digits;
    setRateDrafts((prev) => ({ ...prev, [item.id]: cleaned }));
    const parsed = cleaned === '' || cleaned === '-' ? 0 : Number(cleaned);
    updateLineItem(item.id, { rate: Number.isNaN(parsed) ? 0 : parsed });
  };

  const handleRateBlur = (item: LineItem) => {
    setRateDrafts((prev) => {
      if (!(item.id in prev)) return prev;
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
  };

  // ---------------------------------------------------------------------
  // Live totals
  // ---------------------------------------------------------------------
  // A line item with a negative total (e.g. an old-item buyback) is a
  // deduction, not a taxable sale — it comes off AFTER GST, not before.
  // See calculations.ts for why folding it into the subtotal would
  // undercharge tax.
  const deductionItems = useMemo(() => lineItems.filter((item) => item.total < 0), [lineItems]);
  const subtotal = useMemo(() => computeSubtotal(lineItems), [lineItems]);
  const taxAmount = useMemo(() => computeTax(subtotal, GST_RATE), [subtotal]);
  const totalBeforeDeduction = useMemo(
    () => computeTotalBeforeDeduction(subtotal, taxAmount),
    [subtotal, taxAmount],
  );
  const deductionTotal = useMemo(() => computeDeductionTotal(lineItems), [lineItems]);
  const grandTotal = useMemo(
    () => computeGrandTotal(totalBeforeDeduction, deductionTotal),
    [totalBeforeDeduction, deductionTotal],
  );

  // ---------------------------------------------------------------------
  // Validation + generate flow
  // ---------------------------------------------------------------------
  const validate = (): string | null => {
    if (numberingMode === 'sequential' && !prefix.trim()) {
      return 'Enter a document prefix, like KBL or YL.';
    }
    if (!subject.trim()) return 'Enter the subject of the quotation.';
    if (!clientName.trim()) return "Enter the client's name.";
    if (!selectedTemplateId) return 'Choose a letterhead template.';
    const hasValidItem = lineItems.some((item) => item.description.trim() && item.quantity > 0);
    if (!hasValidItem) return 'Add at least one line item with a description and a quantity above zero.';
    return null;
  };

  const handleGenerate = async () => {
    setFormError(null);
    setSuccessMessage(null);

    const validationError = validate();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    if (!selectedTemplate) {
      setFormError('The selected template is no longer available. Please choose another.');
      return;
    }

    setIsGenerating(true);
    try {
      let quoteNumber: string;
      let cleanPrefix = '';
      let usedFiscalYear = '';
      let sequenceNumber = 0;
      if (numberingMode === 'sequential') {
        sequenceNumber = await getNextSequenceNumber(fiscalYear);
        cleanPrefix = prefix.trim().toUpperCase();
        usedFiscalYear = fiscalYear;
        quoteNumber = `${cleanPrefix}/${fiscalYear}/${sequenceNumber}`;
      } else {
        cleanPrefix = selectedTemplate.fixedPrefix ?? '';
        usedFiscalYear = fiscalYear;
        quoteNumber = `${selectedTemplate.fixedPrefix}/${fiscalYear}/${selectedTemplate.fixedSuffix}`;
      }
      const cleanedLineItems = lineItems.filter((item) => item.description.trim());
      const hasTermsSection = Boolean(selectedTemplate.defaultTerms);
      const cleanedTerms = termsText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      const quotation: Quotation = {
        id: crypto.randomUUID(),
        prefix: cleanPrefix,
        fiscalYear: usedFiscalYear,
        sequenceNumber,
        quoteNumber,
        subject: subject.trim(),
        clientName: clientName.trim(),
        clientAddress: clientAddress.trim(),
        clientGstin: clientGstin.trim(),
        date,
        lineItems: cleanedLineItems,
        subtotal,
        taxRate: GST_RATE,
        taxAmount,
        totalBeforeDeduction,
        deductionTotal,
        grandTotal,
        templateId: selectedTemplate.id,
        createdAt: new Date().toISOString(),
        ...(hasTermsSection ? { termsAndConditions: cleanedTerms, termsColor } : {}),
      };

      await saveQuotation(quotation);
      if (quotation.clientGstin) {
        // Best-effort — never blocks the download if it fails.
        saveClientGstin(quotation.clientName, quotation.clientGstin);
      }
      const pdfBytes = await generateQuotationPdf(quotation, selectedTemplate.downloadUrl);
      downloadPdfBytes(pdfBytes, buildQuotationFileName(quotation));

      setSuccessMessage(`Quotation ${quoteNumber} was generated and downloaded.`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Something went wrong. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const resetForm = () => {
    setPrefix('');
    setSubject('');
    setClientName('');
    setClientAddress('');
    setClientGstin('');
    setDate(new Date().toISOString().slice(0, 10));
    setLineItems([createEmptyLineItem()]);
    setDeductionRowIds(new Set());
    setRateDrafts({});
    if (selectedTemplate?.defaultTerms) {
      setTermsText(selectedTemplate.defaultTerms.join('\n'));
      setTermsColor(selectedTemplate.defaultTermsColor || '#1a1a1a');
    } else {
      setTermsText('');
      setTermsColor('#1a1a1a');
    }
    setFormError(null);
    setSuccessMessage(null);
  };

  // Restores a past quotation's fields into the form, as a starting point
  // for a new one — nothing is submitted automatically, and the quote
  // number itself isn't restored (a fresh one is reserved/computed when
  // Generate is clicked, same as any other quote).
  const loadQuotationIntoForm = (quotation: Quotation) => {
    setPrefix(quotation.prefix);
    setSubject(quotation.subject);
    setClientName(quotation.clientName);
    setClientAddress(quotation.clientAddress);
    setClientGstin(quotation.clientGstin);
    setDate(quotation.date);
    setLineItems(quotation.lineItems.length > 0 ? quotation.lineItems : [createEmptyLineItem()]);
    setDeductionRowIds(new Set(quotation.lineItems.filter((item) => item.total < 0).map((item) => item.id)));
    setRateDrafts({});
    const nextTemplate = templates.find((template) => template.id === quotation.templateId);
    if (nextTemplate) {
      setSelectedTemplateId(nextTemplate.id);
    }
    // Prefer the loaded quotation's own terms (it was generated with them);
    // fall back to the template's defaults only for a pre-this-feature
    // quotation that never had terms saved at all.
    if (quotation.termsAndConditions?.length) {
      setTermsText(quotation.termsAndConditions.join('\n'));
      setTermsColor(quotation.termsColor || nextTemplate?.defaultTermsColor || '#1a1a1a');
    } else if (nextTemplate?.defaultTerms) {
      setTermsText(nextTemplate.defaultTerms.join('\n'));
      setTermsColor(nextTemplate.defaultTermsColor || '#1a1a1a');
    }
    setFormError(null);
    setSuccessMessage(null);
    setActiveTab('form');
  };

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 transition-colors">
      <header className="border-b border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <h1 className="text-xl font-semibold sm:text-2xl">Quotation Builder</h1>
          <button
            type="button"
            onClick={toggleTheme}
            aria-pressed={theme === 'dark'}
            className="rounded-lg border border-neutral-300 dark:border-neutral-600 px-4 py-2.5 text-sm font-medium
                       hover:bg-neutral-100 dark:hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {theme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode'}
          </button>
        </div>
        <nav className="mx-auto flex max-w-4xl gap-1 px-4 sm:px-6" role="tablist" aria-label="Quotation views">
          {(['form', 'history'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors focus:outline-none
                ${
                  activeTab === tab
                    ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                    : 'border-transparent text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
                }`}
            >
              {tab === 'form' ? 'New Quotation' : 'History'}
            </button>
          ))}
        </nav>
      </header>

      {activeTab === 'history' && (
        <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
          <QuotationHistory templates={templates} onLoadIntoForm={loadQuotationIntoForm} />
        </main>
      )}

      {activeTab === 'form' && (
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Status banners */}
        {formError && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800
                       dark:border-red-800 dark:bg-red-950 dark:text-red-200"
          >
            {formError}
          </div>
        )}
        {successMessage && (
          <div
            role="status"
            className="mb-4 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800
                       dark:border-green-800 dark:bg-green-950 dark:text-green-200"
          >
            {successMessage}
          </div>
        )}

        {/* Document details */}
        <fieldset className="mb-6 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-4 sm:p-6">
          <legend className="px-1 text-base font-semibold">Document Details</legend>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {numberingMode === 'sequential' ? (
            <div>
              <label htmlFor="prefix" className={labelClasses}>
                Document Prefix
              </label>
              <input
                id="prefix"
                type="text"
                value={prefix}
                onChange={(event) =>
                  setPrefix(event.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())
                }
                placeholder="KBL"
                maxLength={10}
                className={fieldClasses}
              />
              <p className="mt-1.5 text-sm text-neutral-500 dark:text-neutral-400">
                Will become: <span className="font-medium">{quoteNumberPreview}</span>
              </p>
            </div>
            ) : (
            <div>
              <span className={labelClasses}>Quote Number</span>
              <div className={`${fieldClasses} bg-neutral-100 dark:bg-neutral-700 font-medium`}>
                {fixedQuoteNumber}
              </div>
              <p className="mt-1.5 text-sm text-neutral-500 dark:text-neutral-400">
                This template always uses this number — only the fiscal year changes, automatically.
              </p>
            </div>
            )}

            <div>
              <label id="template-label" className={labelClasses}>
                Letterhead Template
              </label>
              <TemplateDropdown
                templates={templates}
                selectedTemplateId={selectedTemplateId}
                onSelect={handleTemplateSelect}
                loading={templatesLoading}
              />
              {templatesError && (
                <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">
                  {templatesError}{' '}
                  <button
                    type="button"
                    onClick={retryLoadTemplates}
                    className="font-medium underline underline-offset-2 hover:no-underline"
                  >
                    Retry
                  </button>
                </p>
              )}
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="subject" className={labelClasses}>
                Subject of Quotation
              </label>
              <input
                id="subject"
                type="text"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Supply and Installation of Exide Battery Bank"
                className={fieldClasses}
              />
            </div>

            <div className="relative">
              <label htmlFor="clientName" className={labelClasses}>
                Client Name
              </label>
              <input
                id="clientName"
                type="text"
                value={clientName}
                onChange={(event) => {
                  setClientName(event.target.value);
                  setShowClientSuggestions(true);
                }}
                onFocus={() => setShowClientSuggestions(true)}
                onBlur={handleClientNameBlur}
                placeholder="Acme Industries Pvt. Ltd."
                className={fieldClasses}
                autoComplete="off"
                role="combobox"
                aria-expanded={showClientSuggestions && clientSuggestions.length > 0}
                aria-controls="client-suggestions"
                aria-autocomplete="list"
              />
              {showClientSuggestions && clientSuggestions.length > 0 && (
                <ul
                  id="client-suggestions"
                  role="listbox"
                  className="absolute z-10 mt-1.5 w-full overflow-hidden rounded-lg border border-neutral-300
                             dark:border-neutral-600 bg-white dark:bg-neutral-800 shadow-lg"
                >
                  {clientSuggestions.map((client) => (
                    <li key={client.name} role="option" aria-selected={client.name === clientName}>
                      <button
                        type="button"
                        onMouseDown={(event) => {
                          // onMouseDown (not onClick) fires before the input's
                          // onBlur, so the selection registers before the
                          // dropdown's blur-close timer hides it.
                          event.preventDefault();
                          selectClientSuggestion(client);
                        }}
                        className="block w-full px-4 py-2.5 text-left text-base text-neutral-900 dark:text-neutral-100
                                   hover:bg-blue-50 dark:hover:bg-blue-950 focus:outline-none focus:bg-blue-50
                                   dark:focus:bg-blue-950"
                      >
                        {client.name}
                        {client.gstin && (
                          <span className="ml-2 text-sm text-neutral-500 dark:text-neutral-400">{client.gstin}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <label htmlFor="clientAddress" className={labelClasses}>
                Client Address <span className="font-normal text-neutral-500">(optional)</span>
              </label>
              <textarea
                id="clientAddress"
                value={clientAddress}
                onChange={(event) => setClientAddress(event.target.value)}
                placeholder={'Branch or street\nCity'}
                rows={2}
                className={`${fieldClasses} resize-none`}
              />
              <p className="mt-1.5 text-sm text-neutral-500 dark:text-neutral-400">
                One line per line — each becomes its own line under the client's name.
              </p>
            </div>

            <div>
              <label htmlFor="clientGstin" className={labelClasses}>
                Client GSTIN <span className="font-normal text-neutral-500">(optional)</span>
              </label>
              <input
                id="clientGstin"
                type="text"
                value={clientGstin}
                onChange={(event) => setClientGstin(event.target.value.toUpperCase())}
                placeholder="22AAAAA0000A1Z5"
                className={fieldClasses}
              />
              <p className="mt-1.5 text-sm text-neutral-500 dark:text-neutral-400">
                Filled in automatically for clients you've quoted before — feel free to edit it.
              </p>
            </div>

            <div>
              <label htmlFor="date" className={labelClasses}>
                Date
              </label>
              <input
                id="date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className={fieldClasses}
              />
            </div>
          </div>
        </fieldset>

        {/* Line items */}
        <fieldset className="mb-6 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-4 sm:p-6">
          <legend className="px-1 text-base font-semibold">Line Items</legend>
          <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
            Need to deduct something, like an old-item buyback? Add a row for it with a negative rate — it's
            optional and only shows up on the quotation when you use it.
          </p>

          <div className="space-y-4">
            {lineItems.map((item, index) => {
              const isDeductionRow = deductionRowIds.has(item.id);
              return (
              <div
                key={item.id}
                className="grid grid-cols-2 gap-3 rounded-lg border border-neutral-200 dark:border-neutral-700 p-3
                           md:grid-cols-12 md:items-start md:border-0 md:p-0"
              >
                <div className="col-span-2 md:col-span-4">
                  <label htmlFor={`description-${item.id}`} className={labelClasses}>
                    {isDeductionRow ? `Deduction ${index + 1} Description` : `Item ${index + 1} Description`}
                  </label>
                  <input
                    id={`description-${item.id}`}
                    type="text"
                    value={item.description}
                    onChange={(event) => updateLineItem(item.id, { description: event.target.value })}
                    placeholder={isDeductionRow ? 'e.g. Old Battery Buyback' : 'e.g. Exide 150Ah Tubular Battery'}
                    className={fieldClasses}
                  />
                </div>

                <div className="md:col-span-1">
                  <label htmlFor={`quantity-${item.id}`} className={labelClasses}>
                    Quantity
                  </label>
                  <input
                    id={`quantity-${item.id}`}
                    type="number"
                    inputMode="decimal"
                    value={item.quantity}
                    onChange={(event) =>
                      updateLineItem(item.id, { quantity: Number(event.target.value) })
                    }
                    className={numberFieldClasses}
                  />
                </div>

                <div className="md:col-span-2">
                  <label htmlFor={`unit-${item.id}`} className={labelClasses}>
                    Unit <span className="font-normal text-neutral-500">(optional)</span>
                  </label>
                  <input
                    id={`unit-${item.id}`}
                    type="text"
                    value={item.unit}
                    onChange={(event) =>
                      updateLineItem(item.id, { unit: event.target.value.replace(/[^a-zA-Z\s]/g, '') })
                    }
                    placeholder="No, LS, Kg…"
                    className={fieldClasses}
                  />
                </div>

                <div className="md:col-span-2">
                  <label htmlFor={`rate-${item.id}`} className={labelClasses}>
                    {isDeductionRow ? 'Deduction Amount (₹)' : 'Rate (₹)'}
                  </label>
                  <input
                    id={`rate-${item.id}`}
                    type="text"
                    inputMode="decimal"
                    value={rateDisplayValue(item)}
                    onFocus={() => handleRateFocus(item)}
                    onChange={(event) => handleRateChange(item, event.target.value)}
                    onBlur={() => handleRateBlur(item)}
                    placeholder={isDeductionRow ? 'e.g. -1000' : 'Negative to deduct'}
                    className={fieldClasses}
                  />
                </div>

                <div className="md:col-span-2">
                  <span className={labelClasses}>Amount</span>
                  <div className={`${fieldClasses} bg-neutral-100 dark:bg-neutral-700 font-medium`}>
                    {formatCurrencyDisplay(item.total)}
                  </div>
                </div>

                <div className="col-span-2 md:col-span-1">
                  <span
                    className="mb-1.5 hidden text-sm font-medium md:block"
                    aria-hidden="true"
                  >
                    &nbsp;
                  </span>
                  <button
                    type="button"
                    onClick={() => removeLineItem(item.id)}
                    disabled={lineItems.length === 1}
                    aria-label={`Remove item ${index + 1}`}
                    className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 px-3 py-3 text-sm font-medium
                               text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950
                               disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent
                               focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    🗑️
                  </button>
                </div>
              </div>
              );
            })}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={addLineItem}
              className="w-full rounded-lg border-2 border-dashed border-neutral-300 dark:border-neutral-600
                         px-4 py-3 text-base font-medium text-neutral-600 dark:text-neutral-300
                         hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              ➕ Add New Item Row
            </button>
            <button
              type="button"
              onClick={addDeductionItem}
              className="w-full rounded-lg border-2 border-dashed border-neutral-300 dark:border-neutral-600
                         px-4 py-3 text-base font-medium text-neutral-600 dark:text-neutral-300
                         hover:border-amber-500 hover:text-amber-600 dark:hover:text-amber-400
                         focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              ➖ Add Deduction Row
            </button>
          </div>
        </fieldset>

        {/* Terms & Conditions — only templates that actually have this
            section in their letter show it (SPE, SPE AMC, Seshadripuram) */}
        {selectedTemplate?.defaultTerms && (
          <fieldset className="mb-6 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-4 sm:p-6">
            <legend className="px-1 text-base font-semibold">Terms &amp; Conditions</legend>
            <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
              One line per point. Pre-filled from this template's usual terms — edit freely for this quotation only.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label htmlFor="termsText" className={labelClasses}>
                  Terms text
                </label>
                <textarea
                  id="termsText"
                  value={termsText}
                  onChange={(event) => setTermsText(event.target.value)}
                  rows={5}
                  className={`${fieldClasses} resize-y font-mono text-sm`}
                />
              </div>
              <div>
                <label htmlFor="termsColor" className={labelClasses}>
                  Text color
                </label>
                <div className="flex items-center gap-3">
                  <input
                    id="termsColor"
                    type="color"
                    value={termsColor}
                    onChange={(event) => setTermsColor(event.target.value)}
                    className="h-12 w-16 cursor-pointer rounded-lg border border-neutral-300 dark:border-neutral-600
                               bg-white dark:bg-neutral-800 p-1"
                  />
                  <span className="text-sm text-neutral-500 dark:text-neutral-400">{termsColor}</span>
                </div>
              </div>
            </div>
          </fieldset>
        )}

        {/* Totals */}
        <section
          aria-label="Totals"
          className="mb-6 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-4 sm:p-6"
        >
          <dl className="ml-auto max-w-xs space-y-2">
            <div className="flex items-center justify-between">
              <dt className="text-neutral-600 dark:text-neutral-400">Subtotal</dt>
              <dd className="font-medium">{formatCurrencyDisplay(subtotal)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-neutral-600 dark:text-neutral-400">GST (18%)</dt>
              <dd className="font-medium">{formatCurrencyDisplay(taxAmount)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-neutral-600 dark:text-neutral-400">Total</dt>
              <dd className="font-medium">{formatCurrencyDisplay(totalBeforeDeduction)}</dd>
            </div>
            {deductionItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between">
                <dt className="text-neutral-600 dark:text-neutral-400">
                  Less: {item.description || 'Deduction'}
                </dt>
                <dd className="font-medium">{formatCurrencyDisplay(Math.abs(item.total))}</dd>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-neutral-200 dark:border-neutral-700 pt-2 text-lg">
              <dt className="font-semibold">Grand Total</dt>
              <dd className="font-semibold">{formatCurrencyDisplay(grandTotal)}</dd>
            </div>
          </dl>
        </section>

        {/* Generate action */}
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating}
            className="w-full flex-1 rounded-lg bg-blue-600 px-6 py-4 text-lg font-semibold text-white
                       hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60
                       focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                       dark:focus:ring-offset-neutral-900 transition-colors"
          >
            {isGenerating ? 'Generating…' : '📥 Download PDF Document'}
          </button>
          <button
            type="button"
            onClick={resetForm}
            disabled={isGenerating}
            className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 px-6 py-4 text-lg font-medium
                       text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700
                       disabled:cursor-not-allowed disabled:opacity-60
                       focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors sm:w-auto sm:px-8"
          >
            ↺ Reset Form
          </button>
        </div>
      </main>
      )}
    </div>
  );
}
