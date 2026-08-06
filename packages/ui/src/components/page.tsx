import type { ReactNode } from 'react';

import { cn } from '../utils/cn';

/**
 * Page structure.
 *
 * Sections are separated by gradation rules and space, not by nested
 * containers. More space above a heading than below it, so a heading reads as
 * belonging to what follows rather than floating between two blocks.
 */

export interface PageProps {
  readonly children: ReactNode;
  readonly className?: string;
}

export function Page({ children, className }: PageProps) {
  return (
    <div className={cn('mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-14', className)}>
      {children}
    </div>
  );
}

export interface PageHeaderProps {
  readonly title: string;
  readonly detail?: string;
  readonly actions?: ReactNode;
  readonly className?: string;
}

export function PageHeader({ title, detail, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('mb-10 flex items-end justify-between gap-6', className)}>
      <div className="min-w-0">
        <h1
          className="text-3xl font-medium text-balance sm:text-4xl"
          style={{ letterSpacing: 'var(--tracking-display)', lineHeight: 1.1 }}
        >
          {title}
        </h1>
        {detail && (
          <p className="mt-2 max-w-[68ch] text-pretty text-[color:var(--color-ink-secondary)]">
            {detail}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export interface SectionProps {
  readonly title?: string;
  readonly detail?: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}

export function Section({ title, detail, actions, children, className }: SectionProps) {
  return (
    <section className={cn('mt-14 first:mt-0', className)}>
      {(title ?? actions) && (
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <div>
            {title && (
              <h2
                className="text-lg font-medium"
                style={{ letterSpacing: 'var(--tracking-title)' }}
              >
                {title}
              </h2>
            )}
            {detail && (
              <p className="mt-1 text-sm text-[color:var(--color-ink-secondary)]">{detail}</p>
            )}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** A hairline gradation. The system's structural device. */
export function Rule({
  strong,
  className,
}: {
  readonly strong?: boolean;
  readonly className?: string;
}) {
  return (
    <hr
      className={cn(
        'border-0 border-t',
        strong ? 'border-[color:var(--color-rule-strong)]' : 'border-[color:var(--color-rule)]',
        className,
      )}
    />
  );
}
