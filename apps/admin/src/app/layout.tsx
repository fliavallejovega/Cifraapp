import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { archivo, chivoMono } from './fonts';
import './globals.css';

/**
 * The console shell.
 *
 * English only, and deliberately so. This surface is internal; every string on
 * it is read by somebody who works on the product, and running it through a
 * bilingual catalogue would double the maintenance of copy no customer will
 * ever see. The customer-facing applications keep the rule.
 *
 * The typefaces and the ink chrome are the product's, because this console
 * reads the same money and should read it the same way. What it does not
 * inherit is the theme switch: an operational surface has one appearance, so
 * two administrators looking at the same figure over a shoulder are looking at
 * the same screen.
 */
export const metadata: Metadata = {
  title: { default: 'Console · Cifraapp', template: '%s · Cifraapp Console' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#151d2e',
  width: 'device-width',
  initialScale: 1,
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${chivoMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
