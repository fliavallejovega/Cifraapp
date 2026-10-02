import { loadHouseholdContext } from '@/server/household-context';
import { loadTripReport, tripsEnabled } from '@/server/repositories/trips';
import { loadSession } from '@/server/session';

/**
 * A trip's expenses as CSV: one row per movement, with the amount in the
 * household currency and, beside it, what was paid at the destination and at
 * which rate. Read under the person's own RLS, like every screen.
 */
export const dynamic = 'force-dynamic';

/** Excel needs the byte-order mark to read UTF-8 accents. */
const BOM = String.fromCharCode(0xfeff);

const HEADERS = {
  es: [
    'fecha',
    'dia_del_viaje',
    'categoria',
    'descripcion',
    'monto',
    'moneda',
    'monto_original',
    'moneda_original',
    'tasa',
  ],
  en: [
    'date',
    'trip_day',
    'category',
    'description',
    'amount',
    'currency',
    'original_amount',
    'original_currency',
    'rate',
  ],
} as const;

/** RFC 4180 quoting, and a leading quote on anything a spreadsheet would run as a formula. */
function cell(value: string | null | undefined): string {
  const text = value ?? '';
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tripId: string }> },
): Promise<Response> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return new Response('Unauthorized', { status: 401 });
  if (!(await tripsEnabled(session, session.activeHouseholdId)))
    return new Response('Not found', { status: 404 });
  const { tripId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(tripId)) return new Response('Not found', { status: 404 });

  const locale = new URL(request.url).searchParams.get('locale') === 'en' ? 'en' : 'es';
  const context = loadHouseholdContext(session, session.activeHouseholdId, locale);
  const view = await loadTripReport(
    session,
    session.activeHouseholdId,
    tripId,
    context.today,
    context.currency,
  );
  if (!view) return new Response('Not found', { status: 404 });

  const base = view.dashboard.trip.baseCurrency.trim();
  const rows = view.dashboard.expenses.map((e) =>
    [
      e.date,
      e.tripDay ?? '',
      e.category ?? '',
      e.description,
      e.amount.replace(/^-/, ''),
      base,
      e.originalAmount?.replace(/^-/, '') ?? '',
      e.originalCurrency?.trim() ?? '',
      e.fxRate ?? '',
    ]
      .map(cell)
      .join(','),
  );
  const csv = `${BOM}${HEADERS[locale].join(',')}\n${rows.join('\n')}\n`;
  const name =
    view.dashboard.trip.name
      .normalize('NFD')
      .replace(/[^\w]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'viaje';
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${name}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
