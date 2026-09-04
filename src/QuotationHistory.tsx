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
import { buildQuotationFileName, downloadPdfBytes, generateQuotationPdf } from './pdfGenerator';
import { formatCurrencyDisplay } from './calculations';

interface QuotationHistoryProps {
  templates: Template[];
  onLoadIntoForm: (quotation: Quotation) => void;
}

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
// Fetched once, paginated client-side from there — simpler than Firestore
// cursor pagination, and plenty for how many quotations a single business
// realistically generates before this would need revisiting.
const HISTORY_FETCH_LIMIT = 200;

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
  const [pageSize, setPageSize] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    let ignore = false;
    listRecentQuotations(HISTORY_FETCH_LIMIT)
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

  const totalPages = Math.max(1, Math.ceil(quotations.length / pageSize));
  // Clamped rather than stored directly, so shrinking the list (or the page
  // size) can never leave currentPage pointing past the last real page.
  const clampedPage = Math.min(currentPage, totalPages);
  const startIndex = (clampedPage - 1) * pageSize;
  const visibleQuotations = quotations.slice(startIndex, startIndex + pageSize);

  const handlePageSizeChange = (nextSize: number) => {
    setPageSize(nextSize);
    setCurrentPage(1);
  };

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
      downloadPdfBytes(pdfBytes, buildQuotationFileName(quotation));
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

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Showing {startIndex + 1}–{Math.min(startIndex + pageSize, quotations.length)} of {quotations.length}
        </p>
        <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
          Show
          <select
            value={pageSize}
            onChange={(event) => handlePageSizeChange(Number(event.target.value))}
            className="rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800
                       px-3 py-1.5 text-sm text-neutral-900 dark:text-neutral-100
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size} per page
              </option>
            ))}
          </select>
        </label>
      </div>

      <ul className="space-y-3">
        {visibleQuotations.map((quotation) => (
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

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
            disabled={clampedPage <= 1}
            className="rounded-lg border border-neutral-300 dark:border-neutral-600 px-4 py-2 text-sm font-medium
                       text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700
                       disabled:cursor-not-allowed disabled:opacity-50
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            ← Previous
          </button>
          <span className="text-sm text-neutral-500 dark:text-neutral-400">
            Page {clampedPage} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
            disabled={clampedPage >= totalPages}
            className="rounded-lg border border-neutral-300 dark:border-neutral-600 px-4 py-2 text-sm font-medium
                       text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700
                       disabled:cursor-not-allowed disabled:opacity-50
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
