import { Card, EmptyState, Page, PageHeader, Problem, Section } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ChatComposer } from '@/components/chat-composer';
import { Link } from '@/i18n/navigation';
import { formatMoment } from '@/lib/format';
import { copilotIsConfigured } from '@/server/ai';
import { loadHouseholdContext } from '@/server/household-context';
import { loadThreads } from '@/server/repositories/chat';
import { requireHousehold } from '@/server/session';

/**
 * Asking the system about your own money.
 *
 * The assistant queries nothing. It is handed a fixed set of facts assembled by
 * the same readers the screens use, and told that a partial answer built on an
 * assumption is worse than none. Every exchange is stored with the grounding it
 * was answered from, which is what makes an answer read in March checkable
 * against something.
 *
 * When the copilot is not configured the screen says so plainly. A chat box
 * that silently fails would suggest the product is broken; it is not — every
 * figure in it is computed by the engines, and this is the one surface that
 * genuinely needs a model.
 */
export default async function ChatPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = await loadHouseholdContext(session, session.activeHouseholdId, locale);
  const threads = await loadThreads(session, session.activeHouseholdId);

  const t = await getTranslations('chat');
  const configured = copilotIsConfigured();

  return (
    <Page>
      <PageHeader title={t('title')} detail={t('detail')} />

      {!configured ? (
        <Problem title={t('off.title')} body={t('off.body')} />
      ) : (
        <Card padding="lg">
          <ChatComposer
            locale={locale}
            labels={{
              ask: t('ask'),
              askHint: t('askHint'),
              submit: t('submit'),
              thinking: t('thinking'),
              errorTitle: t('errorTitle'),
              errors: {
                copilotOff: t('errors.copilotOff'),
                questionRequired: t('errors.questionRequired'),
                createFailed: t('errors.createFailed'),
                signInRequired: t('errors.signInRequired'),
                notFound: t('errors.notFound'),
                generic: t('errors.generic'),
              },
            }}
          />
        </Card>
      )}

      <Section title={t('threads.title')} className="mt-12">
        {threads.length === 0 ? (
          <Card>
            <EmptyState title={t('threads.empty')} />
          </Card>
        ) : (
          <ul className="flex flex-col">
            {threads.map((thread) => (
              <li
                key={thread.id}
                className="border-b border-[color:var(--color-rule)] last:border-b-0"
              >
                <Link
                  href={`/chat/${thread.id}`}
                  className="flex flex-col gap-1 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-brand)]"
                >
                  <span className="font-medium text-[color:var(--color-ink)]">{thread.title}</span>
                  <span className="text-sm text-[color:var(--color-ink-secondary)]">
                    {t('threads.messages', { count: thread.messageCount })}
                    {' · '}
                    <span className="readout">
                      {formatMoment(thread.updatedAt, locale, context.timeZone)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Page>
  );
}
