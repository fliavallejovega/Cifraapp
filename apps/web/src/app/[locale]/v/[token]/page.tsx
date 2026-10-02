import { Card, Page, PageHeader, Status } from '@app/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { RouteExplorer } from '@/components/rumbo/route-explorer';
import { presentRoute, presentTodos, type Presenter } from '@/server/rumbo-present';
import { sharedTrip } from '@/server/rumbo-share';
import { getClientEnv } from '@app/validation/env';

/**
 * A trip shared by link: the route, the days, what to watch out for and what
 * is left to buy — read-only, without an account, and without any amount the
 * household entered. Not indexed.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const view = await sharedTrip(token);
  return { title: view?.trip.name ?? 'Rumbo', robots: { index: false, follow: false } };
}

export default async function SharedTripPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);
  const view = await sharedTrip(token);
  if (!view?.itinerary) notFound();
  const t = await getTranslations('rumbo');
  const p: Presenter = { t, locale };
  const route = presentRoute(p, view);
  const todos = presentTodos(p, view).filter((todo) => todo.status !== 'bought');

  return (
    <Page>
      <PageHeader title={view.trip.name} {...(route.summary ? { detail: route.summary } : {})} />
      <div className="flex flex-col gap-8">
        {route.sacrifices && <p className="max-w-[68ch] text-pretty">{route.sacrifices}</p>}
        <RouteExplorer
          data={route}
          locale={locale}
          readOnly
          mapsKey={getClientEnv().NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null}
        />
        {todos.length > 0 && (
          <Card padding="lg">
            <h2 className="mb-4 text-lg font-medium">{t('todos.title')}</h2>
            <ul className="flex flex-col">
              {todos.map((todo) => (
                <li
                  key={todo.key}
                  className="flex flex-col gap-1 border-t border-[color:var(--color-rule)] py-3 first:border-t-0"
                >
                  {todo.url ? (
                    <a
                      href={todo.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium underline decoration-[color:var(--color-rule-strong)] underline-offset-4"
                    >
                      {todo.title}
                    </a>
                  ) : (
                    <span className="font-medium">{todo.title}</span>
                  )}
                  <span className="flex flex-wrap gap-2 text-sm text-[color:var(--color-ink-secondary)]">
                    {todo.due && (
                      <Status tone="neutral">{t('todos.due', { date: todo.due })}</Status>
                    )}
                    {todo.saleOpens && <Status tone="caution">{todo.saleOpens}</Status>}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <p className="max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
          {t('entry.disclaimer')}
        </p>
      </div>
    </Page>
  );
}
