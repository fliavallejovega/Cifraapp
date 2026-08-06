import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { routing } from '@/i18n/routing';

import '../globals.css';

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
    title: t('appName'),
    description: t('tagline'),
    robots: { index: false, follow: false },
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
  // Migration is tracked for Phase 1, when the app's routing settles.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  return (
    <html lang={locale}>
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
