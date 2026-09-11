#!/usr/bin/env node
/**
 * ¿Funciona el correo de Cifraapp? Contestado contra Brevo, no supuesto.
 *
 *   node scripts/check-brevo.mjs                      # clave y remitente
 *   node scripts/check-brevo.mjs --send tu@correo.com # y además manda uno de prueba
 *
 * ## Por qué existe
 *
 * «El correo está configurado» se afirmó sin que nadie lo hubiera probado: el
 * código de envío existía, la variable estaba declarada en el esquema, y ni
 * producción ni el entorno local tenían la clave. La tabla de entregas estaba
 * vacía. Nada fallaba, porque nada se intentaba.
 *
 * Este script responde las tres preguntas que deciden si un correo sale, en el
 * orden en que fallan de verdad:
 *
 *   1. ¿La clave existe y Brevo la acepta?        GET /v3/account
 *   2. ¿El remitente está verificado en Brevo?     GET /v3/senders
 *      Sin esto Brevo acepta la clave y rechaza cada envío con un 400 — el fallo
 *      más común, y el que menos se ve, porque la clave «funciona».
 *   3. ¿Un correo real llega a salir?              POST /v3/smtp/email
 *      Con la misma forma exacta que usa `apps/web/src/server/mail.ts`, para que
 *      lo que se prueba sea lo que corre en producción.
 *
 * Nunca imprime la clave. Sale con código 0 y la marca `BREVO OK` sólo si cada
 * paso pedido pasó.
 */
import { existsSync, readFileSync } from 'node:fs';

const API = 'https://api.brevo.com/v3';

/** `.env.local` primero; el entorno del proceso gana, como en producción. */
function loadEnv() {
  const values = {};
  if (existsSync('.env.local')) {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match?.[1]) values[match[1]] = (match[2] ?? '').replace(/^["']|["']$/g, '');
    }
  }
  for (const key of ['BREVO_API_KEY', 'MAIL_FROM_EMAIL', 'MAIL_FROM_NAME']) {
    if (process.env[key]) values[key] = process.env[key];
  }
  return values;
}

const env = loadEnv();
const sendTo = (() => {
  const i = process.argv.indexOf('--send');
  return i === -1 ? null : (process.argv[i + 1] ?? null);
})();

let failed = false;
const fail = (message) => {
  failed = true;
  console.error(`✗ ${message}`);
};

async function call(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'api-key': env.BREVO_API_KEY,
      accept: 'application/json',
      'content-type': 'application/json',
      ...init.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  return { status: response.status, ok: response.ok, body };
}

// ── 0. Lo que tiene que existir antes de llamar a nadie ───────────────────────
if (!env.BREVO_API_KEY) {
  fail('no hay BREVO_API_KEY ni en .env.local ni en el entorno');
  console.error('  Sin ella `sendMail` devuelve «skipped: noMailKey» y ningún aviso sale.');
  process.exit(1);
}
console.log('· BREVO_API_KEY presente');

if (!env.MAIL_FROM_EMAIL) {
  fail('no hay MAIL_FROM_EMAIL: la clave sola no alcanza, Brevo exige un remitente');
} else {
  console.log(`· remitente declarado: ${env.MAIL_FROM_EMAIL}`);
}

// ── 1. ¿Brevo acepta la clave? ────────────────────────────────────────────────
const account = await call('/account');
if (!account.ok) {
  fail(`Brevo rechazó la clave: HTTP ${String(account.status)} ${JSON.stringify(account.body).slice(0, 160)}`);
  process.exit(1);
}
const credits = (account.body?.plan ?? [])
  .map((plan) => `${plan.type}: ${String(plan.credits ?? '—')} créditos`)
  .join(' · ');
console.log(`✓ clave aceptada — cuenta ${account.body?.email ?? '(sin correo)'} · ${credits || 'sin plan informado'}`);

// ── 2. ¿El remitente está verificado? ─────────────────────────────────────────
if (env.MAIL_FROM_EMAIL) {
  const senders = await call('/senders');
  if (!senders.ok) {
    fail(`no se pudo leer la lista de remitentes: HTTP ${String(senders.status)}`);
  } else {
    const list = senders.body?.senders ?? [];
    const mine = list.find(
      (sender) => sender.email?.toLowerCase() === env.MAIL_FROM_EMAIL.toLowerCase(),
    );
    if (!mine) {
      fail(
        `${env.MAIL_FROM_EMAIL} no está entre los remitentes de esta cuenta de Brevo ` +
          `(hay ${String(list.length)}). Brevo va a rechazar cada envío con un 400.`,
      );
    } else if (mine.active === false) {
      fail(`${env.MAIL_FROM_EMAIL} existe en Brevo pero no está verificado todavía`);
    } else {
      console.log(`✓ remitente verificado: ${mine.name ?? ''} <${mine.email}>`);
    }
  }
}

// ── 3. Un correo de verdad ────────────────────────────────────────────────────
if (sendTo) {
  if (failed) {
    console.error('· no se manda el correo de prueba: los pasos anteriores ya fallaron');
  } else {
    const sent = await call('/smtp/email', {
      method: 'POST',
      body: JSON.stringify({
        sender: { email: env.MAIL_FROM_EMAIL, name: env.MAIL_FROM_NAME ?? 'Cifra' },
        to: [{ email: sendTo }],
        subject: 'Cifraapp · prueba de correo',
        textContent:
          'Si estás leyendo esto, Cifraapp puede mandarte avisos por correo: la clave de Brevo funciona y el remitente está verificado.',
      }),
    });
    if (!sent.ok) {
      fail(`Brevo no aceptó el envío: HTTP ${String(sent.status)} ${JSON.stringify(sent.body).slice(0, 200)}`);
    } else {
      console.log(`✓ correo aceptado por Brevo para ${sendTo} — messageId ${sent.body?.messageId ?? '(sin id)'}`);
      console.log('  Aceptado no es entregado: confirmá que llegó a la bandeja (y no a spam).');
    }
  }
}

if (failed) process.exit(1);
console.log(sendTo ? '\nBREVO OK — clave, remitente y envío' : '\nBREVO OK — clave y remitente (sin envío de prueba)');
