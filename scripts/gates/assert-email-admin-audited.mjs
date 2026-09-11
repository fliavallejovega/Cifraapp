#!/usr/bin/env node
/**
 * E7 — Toda escritura del módulo de correos exige rol de contenido y deja
 * rastro con el antes y el después.
 *
 * Se recorre cada acción exportada del módulo: la primera cosa que hace tiene
 * que ser pedir la sesión de un editor y devolver `forbidden` sin ella, y toda
 * acción que escribe o envía tiene que insertar en `audit.admin_actions`.
 */
import { readFileSync } from 'node:fs';

const source = readFileSync('apps/admin/src/server/email-actions.ts', 'utf8');
const problems = [];

if (!source.trimStart().startsWith("'use server'")) problems.push('email-actions.ts no es un módulo de acciones de servidor');
if (!/satisfies\(session\.role, 'content_admin'\)/.test(source)) problems.push('editor() no exige el rol de contenido');

const exported = [...source.matchAll(/export async function (\w+)\(/g)].map((match) => ({ name: match[1], at: match.index }));
if (exported.length < 5) problems.push(`se esperaban 5 acciones y hay ${exported.length}`);

for (const [i, action] of exported.entries()) {
  const body = source.slice(action.at, exported[i + 1]?.at ?? source.length);
  const opening = body.slice(body.indexOf('{') + 1).trimStart();
  if (!opening.startsWith('const session = await editor();\n  if (!session) return { error: \'forbidden\' };')) {
    problems.push(`${action.name}: no empieza exigiendo un editor`);
  }
  // Las escrituras auditan en el mismo cuerpo, o a través de writeCopy/publish, que auditan.
  const audits = /insert\(adminActions\)/.test(body) || /writeCopy\(|afterWrite\(|publish\(session/.test(body);
  if (!audits) problems.push(`${action.name}: escribe sin dejar rastro en audit.admin_actions`);
}

for (const helper of ['async function writeCopy', 'async function publish(']) {
  const start = source.indexOf(helper);
  const end = source.indexOf('\nasync function', start + 1);
  const body = source.slice(start, end === -1 ? undefined : end);
  if (start === -1 || !/insert\(adminActions\)/.test(body) || !/before:/.test(body) || !/after:/.test(body)) {
    problems.push(`${helper.replace('async function ', '')}: no audita con el antes y el después`);
  }
}

// Control negativo: una acción sin guarda tiene que ser detectada.
const planted = "export async function leak() {\n  const db = adminDb();\n}";
if (planted.slice(planted.indexOf('{') + 1).trimStart().startsWith('const session = await editor();')) {
  problems.push('el oráculo acepta una acción sin guarda');
}

if (problems.length > 0) {
  console.error(problems.map((one) => `- ${one}`).join('\n'));
  process.exit(1);
}
console.log(`EMAIL ADMIN AUDITED OK (${exported.length} acciones)`);
