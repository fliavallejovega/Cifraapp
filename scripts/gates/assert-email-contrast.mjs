#!/usr/bin/env node
/**
 * E4 — Todo texto del correo se lee: contraste AA sobre su fondo real.
 *
 * Los pares son los que el diseño usa de verdad, en claro y en oscuro: el
 * cuerpo sobre la tarjeta, lo secundario sobre la tarjeta, la nota al pie sobre
 * el papel, el botón sobre su tinta y el código sobre su fondo hundido. 4.5:1
 * para todo, incluido lo grande: un correo se lee en un teléfono al sol.
 */
import { loadEmail } from './_email.mjs';

const { LIGHT, DARK } = await loadEmail();

function luminance(hex) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Controles: negro sobre blanco es 21, y #999 sobre blanco no llega.
if (Math.abs(contrast('#000000', '#FFFFFF') - 21) > 0.01 || contrast('#999999', '#FFFFFF') >= 4.5) {
  console.error('- la fórmula de contraste está mal: el gate no mide nada');
  process.exit(1);
}

const PAIRS = [
  ['cuerpo', 'ink', 'surface'],
  ['secundario', 'inkSecondary', 'surface'],
  ['nota al pie', 'inkTertiary', 'ground'],
  ['respaldo del botón', 'inkTertiary', 'surface'],
  ['marca', 'ink', 'ground'],
  ['botón', 'panelInk', 'panel'],
  ['código', 'ink', 'groundSunk'],
];

const problems = [];
const lines = [];
for (const [scheme, palette] of [['claro', LIGHT], ['oscuro', DARK]]) {
  for (const [name, fg, bg] of PAIRS) {
    const ratio = contrast(palette[fg], palette[bg]);
    lines.push(`${scheme} · ${name}: ${ratio.toFixed(2)}`);
    if (ratio < 4.5) problems.push(`${scheme} · ${name}: ${palette[fg]} sobre ${palette[bg]} da ${ratio.toFixed(2)}, menos de 4.5`);
  }
}

if (problems.length > 0) {
  console.error(problems.map((one) => `- ${one}`).join('\n'));
  process.exit(1);
}
console.log(lines.join('\n'));
console.log(`EMAIL CONTRAST OK (${lines.length} pares)`);
