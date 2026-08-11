import { EmptyState, Page, PageHeader, Status } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { loadLegalDocument } from '@/server/repositories/content';

import { Prose } from './prose';
import { MarketingShell } from './site-chrome';

/**
 * A legal document, with its version and its review state on the page.
 *
 * The review state is shown rather than hidden. A terms page nobody qualified
 * has read is a placeholder, and a product that presents one as though it were
 * settled is making a claim it cannot support — to users, and eventually to
 * whoever asks about it.
 *
 * When counsel has reviewed a version, `reviewedAt` is stamped and the notice
 * disappears on its own. Nothing needs to be remembered.
 */
export async function LegalPageView({
  locale,
  kind,
}: {
  locale: string;
  kind: 'terms' | 'privacy' | 'tax_disclaimer' | 'cookies';
}) {
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const t = await getTranslations('marketing');
  const document = await loadLegalDocument(kind, locale);

  return (
    <Page>
      <MarketingShell locale={locale}>
        {document ? (
          <article>
            <PageHeader
              title={document.title}
              detail={t('legal.version', { version: document.version })}
            />

            {!document.reviewedAt && (
              <p className="mb-10 flex flex-wrap items-baseline gap-3">
                <Status tone="caution">{t('legal.unreviewedBadge')}</Status>
                <span className="max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
                  {t('legal.unreviewed')}
                </span>
              </p>
            )}

            <Prose body={document.body} />
          </article>
        ) : (
          <EmptyState title={t('legal.missing.title')} body={t('legal.missing.body')} />
        )}
      </MarketingShell>
    </Page>
  );
}
