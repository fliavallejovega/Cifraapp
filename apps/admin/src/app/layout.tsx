import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

/**
 * The admin shell.
 *
 * English only, and deliberately so. This surface is internal; every string on
 * it is read by someone who works on the product, and running it through a
 * bilingual catalogue would double the maintenance of copy no customer will ever
 * see. The customer-facing applications keep the rule.
 */
export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
