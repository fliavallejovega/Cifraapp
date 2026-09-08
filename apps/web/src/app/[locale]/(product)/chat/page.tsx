import { setRequestLocale } from 'next-intl/server';

import { ChatScreen } from '@/components/chat-screen';

/**
 * Asking the system about your own money.
 *
 * Continues the most recent conversation rather than opening a blank one:
 * somebody who asked a question this morning and comes back after lunch wants
 * the thread they were in, not a fresh page that has forgotten it.
 */
export default async function ChatPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  return <ChatScreen locale={locale} />;
}
