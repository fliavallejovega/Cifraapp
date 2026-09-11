import { z } from 'zod';

/**
 * Configuration that must never reach the browser bundle: database credentials,
 * service-role keys, provider secrets (spec §121).
 */
export const serverEnvSchema = z.object({
  APP_ENV: z.enum(['development', 'preview', 'production']).default('development'),

  /**
   * Pooled connection, used by the application at request time. Supabase's
   * transaction pooler runs on port 6543 and does not support prepared
   * statements — the client disables them accordingly.
   */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required.'),

  /**
   * Direct connection (port 5432). Migrations and long transactions need a
   * session-mode connection; running them through the transaction pooler fails
   * in ways that are hard to diagnose.
   */
  DIRECT_URL: z.string().min(1, 'DIRECT_URL is required.'),

  /**
   * Bypasses row-level security. Server-only, always. Any code path that uses
   * this key is responsible for its own tenant scoping (spec §6, §47).
   */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required.'),

  /**
   * The AI copilot, off unless a deployment turns it on.
   *
   * Off is a working configuration, not a degraded one: the product's decisions
   * are deterministic and every copilot surface renders without a provider
   * (spec §41). A missing key must therefore never fail a boot — it selects the
   * null provider, and the screen says the assistant is unavailable.
   */
  AI_PROVIDER: z.enum(['anthropic', 'openai', 'none']).default('none'),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  /** Overrides the provider's default model. Pricing is read from the database. */
  AI_MODEL: z.string().optional(),

  /**
   * Ceiling per household per calendar month, in whole currency units. Zero is
   * uncapped and is the wrong setting for anything a customer can reach.
   */
  AI_MONTHLY_BUDGET: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, 'AI_MONTHLY_BUDGET must be an amount like "5.00".')
    .default('0'),

  /**
   * Billing, off unless a processor is named.
   *
   * With no processor every household is on the free plan's entitlements and the
   * product works. That is a supported state, not a broken one — and the webhook
   * endpoint refuses everything rather than trusting an unsigned payload.
   */
  BILLING_PROVIDER: z.enum(['stripe', 'none']).default('none'),
  STRIPE_SECRET_KEY: z.string().optional(),
  /** Without this, the webhook endpoint is a public URL that grants subscriptions. */
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  /**
   * Shared secret for Vercel Cron invocations. Vercel sends
   * `Authorization: Bearer <CRON_SECRET>`; without it, the keep-alive route
   * refuses every caller.
   */
  CRON_SECRET: z.string().min(16).optional(),

  /**
   * Brevo, para el correo saliente.
   *
   * Opcional a propósito y comprobado en el momento de enviar: un despliegue sin
   * clave no debe caerse al arrancar, tiene que arrancar y no mandar correos.
   * La diferencia importa — una casa prefiere una aplicación que funciona sin
   * avisos a una que no abre porque falta una clave de un tercero.
   */
  BREVO_API_KEY: z.string().min(16).optional(),
  /**
   * De dónde salen los correos. Un dominio verificado en Brevo; sin él, Brevo
   * rechaza el envío y la entrega queda registrada como fallida con su razón.
   */
  MAIL_FROM_EMAIL: z.email().optional(),
  MAIL_FROM_NAME: z.string().min(1).max(80).optional(),

  /**
   * La API de administración de Supabase, para publicar los correos de cuenta.
   *
   * Sólo la consola la usa, y sólo para escribir las plantillas de correo de
   * inicio de sesión. Es un token personal con alcance de cuenta: opcional, y
   * sin él la consola edita y guarda igual, pero dice que la publicación está
   * pendiente en vez de fingir que Supabase ya tiene el texto nuevo.
   */
  SUPABASE_ACCESS_TOKEN: z.string().min(20).optional(),
  SUPABASE_PROJECT_REF: z.string().regex(/^[a-z0-9]{20}$/).optional(),

  /**
   * El par VAPID que firma cada notificación push.
   *
   * La pública viaja al navegador y por eso vive también en el bloque público;
   * la privada firma y no sale del servidor. Sin las dos, el push queda
   * apagado y las preferencias lo dicen en vez de fallar en silencio.
   */
  VAPID_PRIVATE_KEY: z.string().min(20).optional(),
  /** A quién escribirle si un servicio de push necesita reportar un abuso. */
  VAPID_SUBJECT: z.string().min(5).optional(),

  /**
   * La aplicación de Google con la que un hogar conecta su cuenta.
   *
   * Sirve para dos cosas distintas y opcionales por separado: leer los avisos de
   * transacción que manda el banco, y escribir los compromisos en el calendario.
   * Sin estas dos variables el producto arranca igual y las dos funciones se
   * enseñan apagadas, con el motivo — que es mejor que una pantalla que falla al
   * pulsar «Conectar».
   *
   * El secreto nunca llega al navegador: el intercambio de código por token
   * ocurre entero en el servidor.
   */
  GOOGLE_CLIENT_ID: z.string().min(10).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(10).optional(),
  /**
   * La llave con la que se cifra el refresh token antes de guardarlo.
   *
   * 32 bytes en base64. Sin ella no se guarda ninguna conexión: un refresh token
   * en claro en la base es el buzón de alguien en una copia de seguridad, y
   * `service_role` —que salta toda la seguridad de fila— lo leería entero.
   *
   * Rotarla invalida las conexiones existentes, que es el comportamiento
   * correcto: obliga a reconectar y deja de descifrar lo que se filtró.
   */
  GOOGLE_TOKEN_KEY: z.string().min(32).optional(),
});

/**
 * Configuration that is safe to ship to the browser. Anything added here is
 * public by definition — the `NEXT_PUBLIC_` prefix is the whole contract.
 */
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url('NEXT_PUBLIC_SUPABASE_URL must be a URL.'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required.'),
  NEXT_PUBLIC_APP_URL: z.url('NEXT_PUBLIC_APP_URL must be a URL.'),
  /** Where the administrative console lives. Absent means no link is shown. */
  NEXT_PUBLIC_ADMIN_URL: z.url('NEXT_PUBLIC_ADMIN_URL must be a URL.').optional(),
  /**
   * La mitad pública del par VAPID.
   *
   * Tiene que llegar al navegador —es con lo que se suscribe al push— y por eso
   * es pública por diseño y no por descuido. Ausente significa que el push está
   * apagado, y la pantalla de preferencias lo dice.
   */
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().min(20).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type ClientEnv = z.infer<typeof clientEnvSchema>;
