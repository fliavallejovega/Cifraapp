'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useId, useState } from 'react';

/**
 * Questions that open in place.
 *
 * One open at a time, because the point of the list is to scan questions,
 * not to read every answer. The answer's height animates from zero so the
 * page moves with the reader's click rather than jumping under it.
 */
export function Faq({
  items,
}: {
  readonly items: readonly { question: string; answer: string }[];
}) {
  const [open, setOpen] = useState<number | null>(0);
  const reduced = useReducedMotion();
  const baseId = useId();

  return (
    <dl className="divide-y divide-[color:var(--color-rule)] border-y border-[color:var(--color-rule)]">
      {items.map((item, index) => {
        const isOpen = open === index;
        const panelId = `${baseId}-${String(index)}`;
        return (
          <div key={item.question}>
            <dt>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => {
                  setOpen(isOpen ? null : index);
                }}
                className="flex w-full items-center justify-between gap-6 py-6 text-left text-lg font-medium transition-colors duration-(--duration-quick) hover:text-[color:var(--color-ink-secondary)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[color:var(--color-brand)]"
                style={{ letterSpacing: 'var(--tracking-title)' }}
              >
                <span>{item.question}</span>
                <motion.span
                  aria-hidden
                  className="shrink-0 text-[color:var(--color-ink-tertiary)]"
                  animate={{ rotate: isOpen ? 45 : 0 }}
                  transition={{ duration: reduced ? 0 : 0.3 }}
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                </motion.span>
              </button>
            </dt>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.dd
                  id={panelId}
                  key="panel"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: reduced ? 0 : 0.4, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <p className="max-w-[64ch] pb-6 text-pretty text-[color:var(--color-ink-secondary)]">
                    {item.answer}
                  </p>
                </motion.dd>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </dl>
  );
}
