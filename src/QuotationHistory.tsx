/**
 * QuotationHistory.tsx
 *
 * The History tab: lists past quotations (newest first) from Firestore,
 * with a way to either load one back into the form as a starting point for
 * a new quote, or just re-download its PDF as-is. Fetched once when the
 * tab is first opened, not on every render.
 */

import { useEffect, useState } from 'react';
import type { Quotation, Template } from './types';
import { listRecentQuotations } from './firebaseService';
import { downloadPdfBytes, generateQuotationPdf } from './pdfGenerator';
import { formatCurrencyDisplay } from './calculations';

interface QuotationHistoryProps {
  templates: Template[];
  onLoadIntoForm: (quotation: Quotation) => void;
}

function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function QuotationHistory({ templates, onLoadIntoForm }: QuotationHistoryProps) {
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    listRecentQuotations()
      .then((fetched) => {
        if (!ignore) setQuotations(fetched);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  const templateName = (templateId: string): string =>
    templates.find((template) => template.id === templateId)?.name ?? templateId;

  const handleRedownload = async (quotation: Quotation) => {
    const template = templates.find((t) => t.id === quotation.templateId);
    if (!template) {
      setError(`The "${quotation.templateId}" template is no longer available, so this PDF can't be regenerated.`);
      return;
    }
    setError(null);
    setDownloadingId(quotation.id);
    try {
      const pdfBytes = await generateQuotationPdf(quotation, template.downloadUrl);
      downloadPdfBytes(pdfBytes, `${quotation.quoteNumber.replace(/\//g, '-')}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not regenerate this PDF.');
    } finally {
      setDownloadingId(null);
    }
  };

  if (loading) {
    return <p className="text-neutral-500 dark:text-neutral-400">Loading history…</p>;
  }

  if (quotations.length === 0) {
    return (
      <p className="text-neutral-500 dark:text-neutral-400">
        No quotations generated yet — once you generate one, it'll show up here.
      </p>
    );
  }

  return (
    <div>
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800
                     dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {error}
        </div>
      )}
      <ul className="space-y-3">
        {quotations.map((quotation) => (
          <li
            key={quotation.id}
            className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-4"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-neutral-900 dark:text-neutral-100">{quotation.quoteNumber}</p>
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  {quotation.clientName || 'No client name'} · {templateName(quotation.templateId)} ·{' '}
                  {formatTimestamp(quotation.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <span className="font-medium text-neutral-900 dark:text-neutral-100">
                  {formatCurrencyDisplay(quotation.grandTotal)}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onLoadIntoForm(quotation)}
                    className="rounded-lg border border-neutral-300 dark:border-neutral-600 px-3 py-2 text-sm font-medium
                               text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700
                               focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    Load into Form
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRedownload(quotation)}
                    disabled={downloadingId === quotation.id}
                    className="rounded-lg border border-blue-300 dark:border-blue-700 px-3 py-2 text-sm font-medium
                               text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950
                               disabled:cursor-not-allowed disabled:opacity-60
                               focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {downloadingId === quotation.id ? 'Downloading…' : 'Download PDF'}
                  </button>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
