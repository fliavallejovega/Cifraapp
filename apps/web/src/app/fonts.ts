import { Archivo, Chivo_Mono } from 'next/font/google';

/**
 * Two faces from one foundry (Omnibus-Type), with related skeletons, so they
 * sit together without a seam.
 *
 * Archivo carries the interface: a grotesque with signage roots and a wide
 * weight range, which is the register of gradation labels and instrument
 * lettering rather than of a magazine.
 *
 * Chivo Mono carries measurement — figures, scale labels, read-outs. Monospace
 * here is not a costume for "technical": money is a measurement, and a figure
 * column that reflows as values change is a defect.
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
