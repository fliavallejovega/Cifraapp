import 'server-only';

import { getServerEnv } from '@app/validation/env';

/**
 * La configuración de correo de Supabase, leída y escrita por su API.
 *
 * Supabase manda los correos de cuenta —confirmar, restablecer la contraseña—
 * con las plantillas que tiene guardadas en su configuración. Publicar es
 * escribir ahí; saber si lo publicado es lo último es leer de ahí y comparar.
 * No se guarda en ningún otro lado un «publicado: sí», porque un dato así se
 * desactualiza el día que alguien toca el panel de Supabase a mano, y la
 * pantalla seguiría diciendo que todo está en orden.
 */

export type AuthConfigRead =
  | { readonly status: 'ok'; readonly config: Readonly<Record<string, unknown>> }
  | { readonly status: 'noToken' }
  | { readonly status: 'failed'; readonly reason: string };

export type AuthConfigWrite =
  | { readonly status: 'ok' }
  | { readonly status: 'noToken' }
  | { readonly status: 'failed'; readonly reason: string };

const TIMEOUT_MS = 10_000;

function endpoint(): { url: string; token: string } | null {
  const env = getServerEnv();
  if (!env.SUPABASE_ACCESS_TOKEN || !env.SUPABASE_PROJECT_REF) return null;
  return {
    url: `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/config/auth`,
    token: env.SUPABASE_ACCESS_TOKEN,
  };
}

async function call(method: 'GET' | 'PATCH', body?: Readonly<Record<string, string>>) {
  const target = endpoint();
  if (!target) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, TIMEOUT_MS);

  try {
    return await fetch(target.url, {
      method,
      headers: {
        authorization: `Bearer ${target.token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export function publishingIsConfigured(): boolean {
  return endpoint() !== null;
}

export async function readAuthConfig(): Promise<AuthConfigRead> {
  try {
    const response = await call('GET');
    if (!response) return { status: 'noToken' };
    if (!response.ok) return { status: 'failed', reason: `Supabase answered ${String(response.status)}` };
    return { status: 'ok', config: (await response.json()) as Record<string, unknown> };
  } catch (error: unknown) {
    return { status: 'failed', reason: String(error).slice(0, 200) };
  }
}

export async function writeAuthConfig(fields: Readonly<Record<string, string>>): Promise<AuthConfigWrite> {
  try {
    const response = await call('PATCH', fields);
    if (!response) return { status: 'noToken' };
    if (!response.ok) {
      // Lo que Supabase dice del rechazo es lo único que permite arreglarlo.
      // Acotado, y sin nada de la petición: el cuerpo enviado es la plantilla.
      const detail = await response.text().catch(() => '');
      return { status: 'failed', reason: `${String(response.status)} ${detail.slice(0, 200)}` };
    }
    return { status: 'ok' };
  } catch (error: unknown) {
    return { status: 'failed', reason: String(error).slice(0, 200) };
  }
}
