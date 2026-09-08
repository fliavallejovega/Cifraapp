import { Archivo, Chivo_Mono } from 'next/font/google';

/**
 * The same two faces as the product, and that is the whole point.
 *
 * The console had no font setup at all: `--font-sans` resolved to the token
 * fallback, so an internal tool that shares a design system with the product
 * rendered in a different typeface than the product. Figures were the worse
 * half of it — money and counts were not tabular, so every column of numbers
 * rippled as values changed.
 */

export const archivo = Archivo({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-archivo',
  display: 'swap',
  axes: ['wdth'],
});

export const chivoMono = Chivo_Mono({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-chivo-mono',
  display: 'swap',
  weight: ['400', '500', '600'],
});
