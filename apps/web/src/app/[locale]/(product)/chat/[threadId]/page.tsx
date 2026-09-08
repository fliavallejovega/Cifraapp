import { setRequestLocale } from 'next-intl/server';

import { ChatScreen } from '@/components/chat-screen';

/**
 * One conversation.
 *
 * `new` is not a thread id: it is how «start a fresh one» is expressed as a
 * link, which keeps the action a navigation rather than a button that has to
 * decide what to do before anything has been said.
 */
export default async function ThreadPage({
  params,
}: {
  params: Promise<{ locale: string; threadId: string }>;
}) {
  const { locale, threadId } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  return threadId === 'new' ? (
    <ChatScreen locale={locale} fresh />
  ) : (
    <ChatScreen locale={locale} threadId={threadId} />
  );
}
