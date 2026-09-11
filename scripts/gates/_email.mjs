import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

/**
 * Lo que comparten los gates de correo: el paquete compilado y las claves.
 *
 * Se mide contra `packages/email/dist`, que es lo que importan la app y la
 * consola. Medir contra el código fuente dejaría pasar un paquete que nadie
 * volvió a compilar.
 */
export async function loadEmail() {
  const entry = join(process.cwd(), 'packages/email/dist/index.js');
  if (!existsSync(entry)) throw new Error('packages/email/dist no existe: corré pnpm --filter @app/email build');
  return import(pathToFileURL(entry).href);
}

/** `.env.local` primero, después `.claude/settings.local.json`; el entorno del proceso gana. */
export function loadSecrets() {
  const values = {};
  if (existsSync('.env.local')) {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
  if (existsSync('.claude/settings.local.json')) {
    const env = JSON.parse(readFileSync('.claude/settings.local.json', 'utf8')).env ?? {};
    for (const [key, value] of Object.entries(env)) values[key] ??= value;
  }
  for (const key of Object.keys(values)) if (process.env[key]) values[key] = process.env[key];
  return values;
}

/** Lo editado en la consola, para calcular lo que Supabase debería tener. */
export async function effectiveCopiesFromDb(sql, definition) {
  const rows = await sql`
    select locale, subject, preheader, heading, body, cta_label, footnote
      from platform.email_templates where template_key = ${definition.key}`;
  const pick = (locale) => {
    const row = rows.find((one) => one.locale === locale);
    return row
      ? { subject: row.subject, preheader: row.preheader, heading: row.heading, body: row.body, ctaLabel: row.cta_label, footnote: row.footnote }
      : definition.defaults[locale];
  };
  return { es: pick('es'), en: pick('en') };
}

export async function supabaseConfig(secrets, method = 'GET', body) {
  const ref = secrets.SUPABASE_PROJECT_REF;
  const token = secrets.SUPABASE_ACCESS_TOKEN;
  if (!ref || !token) throw new Error('faltan SUPABASE_PROJECT_REF o SUPABASE_ACCESS_TOKEN');
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`Supabase respondió ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return response.json();
}
