import { Card, EmptyState, Page, PageHeader, Section, Status } from '@app/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ChatComposer } from '@/components/chat-composer';
import { ThreadActions } from '@/components/thread-actions';
import { Link } from '@/i18n/navigation';
import { formatMoment } from '@/lib/format';
import { copilotIsConfigured } from '@/server/ai';
import { loadHouseholdContext } from '@/server/household-context';
import { loadThread } from '@/server/repositories/chat';
import { requireHousehold } from '@/server/session';

/**
 * One conversation, with its evidence.
 *
 * Each answer carries the figures it was allowed to use, shown under it rather
 * than hidden. That is the difference between an assistant and an oracle: «you
 * had $2,740 available» is a claim, and the grounding is what turns it into one
 * anybody can check three months later.
 *
 * Figures the guardrail could not tie back to the grounding are called out on
 * the message itself, never quietly. A number the product cannot verify is the
 * one thing it must not present as if it could.
 */
export default async function ThreadPage({
  params,
}: {
  params: Promise<{ locale: string; threadId: string }>;
}) {
  const { locale, threadId } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireHousehold(locale);
  const context = await loadHouseholdContext(session, session.activeHouseholdId, locale);
  const found = await loadThread(session, session.activeHouseholdId, threadId);

  const t = await getTranslations('chat');
  const shared = await getTranslations('records');

  if (!found) {
    return (
      <Page>
        <PageHeader title={t('title')} />
        <Card>
          <EmptyState
            title={t('errors.notFound')}
            action={
              <Link
                href="/chat"
                className="text-sm font-medium text-[color:var(--color-brand-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:decoration-[color:var(--color-brand)]"
              >
                {t('title')}
              </Link>
            }
          />
        </Card>
      </Page>
    );
  }

  const { thread, messages } = found;

  return (
    <Page>
      <div className="mb-6">
        <Link
          href="/chat"
          className="text-sm text-[color:var(--color-ink-secondary)] underline decoration-[color:var(--color-rule-strong)] underline-offset-4 hover:text-[color:var(--color-ink)] hover:decoration-[color:var(--color-brand)]"
        >
          {t('newThread')}
        </Link>
      </div>

      <PageHeader title={thread.title} />

      <Section>
        <ol className="flex flex-col gap-4">
          {messages.map((message) => (
            <li key={message.id}>
              <Card tone={message.role === 'user' ? 'sunk' : 'surface'}>
                <p className="gradation-label text-[color:var(--color-ink-tertiary)] uppercase">
                  {message.role === 'user' ? t('you') : t('assistant')}
                  {' · '}
                  <span className="readout normal-case">
                    {formatMoment(message.createdAt, locale, context.timeZone)}
                  </span>
                </p>

                <p className="mt-2 max-w-[62ch] text-pretty whitespace-pre-wrap text-[color:var(--color-ink)]">
                  {message.body}
                </p>

                {message.ungrounded.length > 0 && (
                  <p className="mt-3">
                    <Status tone="negative">
                      {t('ungrounded', { figures: message.ungrounded.join(', ') })}
                    </Status>
                  </p>
                )}

                {message.role === 'assistant' && Object.keys(message.grounding).length > 0 && (
                  <details className="mt-4">
                    <summary className="cursor-pointer text-sm text-[color:var(--color-ink-secondary)]">
                      {t('grounding.title')}
                    </summary>
                    <p className="mt-2 text-xs text-[color:var(--color-ink-tertiary)]">
                      {t('grounding.detail')}
                    </p>
                    <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                      {Object.entries(message.grounding).map(([key, value]) => (
                        <div key={key} className="flex gap-2">
                          <dt className="text-[color:var(--color-ink-tertiary)]">{key}</dt>
                          <dd className="readout min-w-0 break-words text-[color:var(--color-ink)]">
                            {value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                )}
              </Card>
            </li>
          ))}
        </ol>
      </Section>

      {copilotIsConfigured() && (
        <Card padding="lg" className="mt-8">
          <ChatComposer
            locale={locale}
            threadId={thread.id}
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

      <Section className="mt-12">
        <Card>
          <ThreadActions
            locale={locale}
            threadId={thread.id}
            labels={{
              remove: t('remove'),
              removeConfirm: t('removeConfirm'),
              cancel: shared('cancel'),
              errorTitle: t('errorTitle'),
              generic: t('errors.generic'),
            }}
          />
        </Card>
      </Section>
    </Page>
  );
}
