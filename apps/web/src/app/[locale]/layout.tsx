import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { PwaRegister } from '@/components/pwa-register';
import { THEME_BOOTSTRAP } from '@/components/theme';
import { RecoveryRedirect } from '@/components/recovery-redirect';
import { routing } from '@/i18n/routing';

import { archivo, chivoMono } from '../fonts';
import '../globals.css';

/**
 * The OS chrome tints to the panel ink, so the installed app opens looking
 * like its own sidebar. One value: the panel is the same deep ink in both
 * themes.
 */
export const viewport: Viewport = {
  themeColor: '#151d2e',
  width: 'device-width',
  initialScale: 1,
  // The drawer gesture owns the horizontal axis on a phone; pinch-zoom stays
  // available because text scaling is an accessibility path, not a luxury.
  viewportFit: 'cover',
};

export function generateStaticParams(): { locale: string }[] {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'common' });

  return {
    title: { default: t('appName'), template: `%s · ${t('appName')}` },
    description: t('tagline'),
    // Closed by default: everything under this segment is a product surface
    // holding somebody's money until a page says otherwise. The public pages
    // opt themselves in through `publicRobots()` in `lib/seo.ts`, which is the
    // safe direction — a marketing page that is accidentally missing from a
    // search index is a bad week, and an account page that is accidentally in
    // one is a breach.
    robots: { index: false, follow: false },
    appleWebApp: {
      capable: true,
      title: t('appName'),
      statusBarStyle: 'black-translucent',
    },
    icons: {
      apple: '/icons/apple-touch-icon.png',
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  // Required for static rendering; without it every page in this segment
  // silently opts into dynamic rendering.
  //
  // next-intl points at `next/root-params` as the successor, but Next 16.3 only
  // generates types for that module during a build, so importing it today
  // resolves to `any` and defeats the strict-type rules this repo runs on.
  // Migration is tracked for Phase 2 (ADR-011).
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  return (
    <html lang={locale} className={`${archivo.variable} ${chivoMono.variable}`}>
      <head>
        {/* Applies the stored theme before the first paint. Without it a person
            who chose dark gets a white flash on every navigation — at night, on
            a financial screen, which is exactly when they chose it. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider>
          <PwaRegister />
          {/* A recovery link can land on any page. This makes every one of them
              know what to do with it. */}
          <RecoveryRedirect locale={locale} />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
