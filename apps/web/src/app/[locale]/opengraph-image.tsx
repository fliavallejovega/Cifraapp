import { ImageResponse } from 'next/og';
import { getTranslations } from 'next-intl/server';

/**
 * The card a link to the home page unfurls into.
 *
 * Generated rather than drawn, so the words stay the ones the page uses and a
 * headline change is not also a design ticket. Colors are the design tokens
 * resolved by hand — the panel ink and the brass — because an image cannot
 * read CSS. Text only: an unfurl is read at thumbnail size, where a product
 * screenshot becomes noise and a sentence stays a sentence.
 */

export const alt = 'Cifrapp';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const COPY = {
  es: {
    kicker: 'App de finanzas familiares · Panamá',
    headline: 'Qué hacer con el próximo dólar.',
    detail:
      'Cuentas, pagos, deudas y metas de tu hogar. Cuánto queda de verdad y un plan cada mes.',
  },
  en: {
    kicker: 'Family finance app · Panama',
    headline: 'What the next dollar should do.',
    detail:
      'Your household’s accounts, bills, debts and goals. What is truly left, and a plan every month.',
  },
} as const;

export default async function OpenGraphImage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const copy = locale === 'en' ? COPY.en : COPY.es;
  const common = await getTranslations({ locale, namespace: 'common' });
  const wordmark = common('appName').toUpperCase();

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 72,
        background: '#151d2e',
        color: '#f2eee6',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 28, letterSpacing: 4, color: '#c9a468' }}>{wordmark}</div>
        <div style={{ fontSize: 24, color: '#b7bcc8' }}>{copy.kicker}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ fontSize: 84, fontWeight: 600, lineHeight: 1.02, letterSpacing: -2 }}>
          {copy.headline}
        </div>
        <div style={{ fontSize: 30, lineHeight: 1.3, color: '#b7bcc8', maxWidth: 980 }}>
          {copy.detail}
        </div>
      </div>
    </div>,
    size,
  );
}
