import { getTranslations } from 'next-intl/server';

import { loadHouseholdContext } from '@/server/household-context';
import { tripsEnabled } from '@/server/repositories/trips';
import { loadRumbo } from '@/server/rumbo';
import { rumboHtml, rumboIcs } from '@/server/rumbo-export';
import { presentLodging, presentRoute, presentTodos } from '@/server/rumbo-present';
import { loadSession } from '@/server/session';

/**
 * Rumbo's trip as a file: `html` (one self-contained page that also prints
 * to PDF) or `ics` (the days, the flights and the purchase deadlines). Read
 * under the person's own RLS, like the screens.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tripId: string; format: string }> },
): Promise<Response> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return new Response('Unauthorized', { status: 401 });
  if (!(await tripsEnabled(session, session.activeHouseholdId)))
    return new Response('Not found', { status: 404 });
  const { tripId, format } = await params;
  if (!/^[0-9a-f-]{36}$/.test(tripId) || (format !== 'html' && format !== 'ics')) {
    return new Response('Not found', { status: 404 });
  }
  const locale = new URL(request.url).searchParams.get('locale') === 'en' ? 'en' : 'es';
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);
  const view = await loadRumbo(session, session.activeHouseholdId, tripId, context.today);
  if (!view?.itinerary) return new Response('Not found', { status: 404 });
  const t = await getTranslations({ locale, namespace: 'rumbo' });
  const p = { t, locale };
  const route = presentRoute(p, view);
  const todos = presentTodos(p, view);
  const slug =
    view.trip.name
      .normalize('NFD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase()
      .slice(0, 60) || 'viaje';

  if (format === 'ics') {
    return new Response(rumboIcs(view, route, todos, new Date()), {
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': `attachment; filename="${slug}.ics"`,
        'cache-control': 'no-store',
      },
    });
  }
  const html = rumboHtml(route, presentLodging(p, view), todos, {
    lang: locale,
    printHint: t('export.printHint'),
    sleep: t('day.sleep'),
    legs: t('day.legs'),
    watch: t('day.watch'),
    todo: t('day.todo'),
    lodging: t('lodging.title'),
    myPrice: t('lodging.totals.myPlan'),
    todos: t('todos.title'),
    due: t('export.due'),
    generated: t('export.generated', { date: context.today }),
    disclaimer: t('entry.disclaimer'),
  });
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-disposition': `attachment; filename="${slug}.html"`,
      'cache-control': 'no-store',
    },
  });
}
