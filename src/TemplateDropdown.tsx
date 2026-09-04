/**
 * TemplateDropdown.tsx
 *
 * Replaces the plain native <select> for choosing a letterhead template
 * with a custom listbox: each option shows its name plus whether it's
 * auto-numbered or uses a fixed quote number, which a native <select>
 * can't display. Closes on selection, outside click, or Escape.
 */

import { useEffect, useRef, useState } from 'react';
import type { Template } from './types';

interface TemplateDropdownProps {
  templates: Template[];
  selectedTemplateId: string;
  onSelect: (id: string) => void;
  loading: boolean;
}

export default function TemplateDropdown({
  templates,
  selectedTemplateId,
  onSelect,
  loading,
}: TemplateDropdownProps) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);

  // Close on a click outside the whole control.
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const openDropdown = () => {
    const currentIndex = templates.findIndex((template) => template.id === selectedTemplateId);
    setHighlightedIndex(currentIndex >= 0 ? currentIndex : 0);
    setOpen(true);
  };

  const handleButtonKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openDropdown();
    }
  };

  const handleListKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((prev) => Math.min(prev + 1, templates.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const template = templates[highlightedIndex];
      if (template) {
        onSelect(template.id);
        setOpen(false);
      }
    }
  };

  const numberingLabel = (template: Template): string =>
    template.numberingMode === 'sequential' ? 'Auto-numbered' : 'Fixed quote number';

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        disabled={loading || templates.length === 0}
        onClick={() => (open ? setOpen(false) : openDropdown())}
        onKeyDown={handleButtonKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Letterhead Template"
        className="flex w-full items-center justify-between rounded-lg border border-neutral-300 dark:border-neutral-600
                   bg-white dark:bg-neutral-800 px-4 py-3 text-left text-base text-neutral-900 dark:text-neutral-100
                   focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors
                   disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span>
          {loading
            ? 'Loading templates…'
            : selectedTemplate
              ? selectedTemplate.name
              : templates.length === 0
                ? 'No templates available'
                : 'Choose a template'}
        </span>
        <span aria-hidden="true" className={`ml-2 transition-transform ${open ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>

      {open && templates.length > 0 && (
        <ul
          role="listbox"
          tabIndex={-1}
          onKeyDown={handleListKeyDown}
          aria-activedescendant={templates[highlightedIndex] ? `template-option-${templates[highlightedIndex].id}` : undefined}
          className="absolute z-10 mt-1.5 w-full overflow-hidden rounded-lg border border-neutral-300
                     dark:border-neutral-600 bg-white dark:bg-neutral-800 shadow-lg"
          ref={(el) => el?.focus()}
        >
          {templates.map((template, index) => {
            const isSelected = template.id === selectedTemplateId;
            const isHighlighted = index === highlightedIndex;
            return (
              <li key={template.id} id={`template-option-${template.id}`} role="option" aria-selected={isSelected}>
                <button
                  type="button"
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => {
                    onSelect(template.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between px-4 py-2.5 text-left focus:outline-none
                    ${isHighlighted ? 'bg-blue-50 dark:bg-blue-950' : ''}`}
                >
                  <span>
                    <span className="block text-base text-neutral-900 dark:text-neutral-100">{template.name}</span>
                    <span className="block text-sm text-neutral-500 dark:text-neutral-400">
                      {numberingLabel(template)}
                    </span>
                  </span>
                  {isSelected && (
                    <span aria-hidden="true" className="ml-2 text-blue-600 dark:text-blue-400">
                      ✓
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
