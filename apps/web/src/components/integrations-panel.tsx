'use client';

import { Button, Card, EmptyState, Problem, Status } from '@app/ui';
import { useActionState } from 'react';

import { createCalendarFeed, disconnectGoogle, revokeCalendarFeed } from '@/server/integration-actions';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * Lo conectado hacia fuera: la cuenta de Google y el calendario suscribible.
 *
 * Dos cosas que se parecen y no lo son, y la pantalla las separa a propósito:
 *
 *   * **El calendario suscribible** no pide cuenta de nadie. Se genera un enlace
 *     y se pega en Apple Calendar o en Google Calendar. Es la opción que
 *     funciona hoy, para todo el mundo, y por eso va primera.
 *   * **La cuenta de Google** da más —eventos que se pueden tocar, y los avisos
 *     del banco leídos solos— y a cambio pide permisos sobre el correo de
 *     alguien. Va segunda y dice exactamente qué pide.
 *
 * El enlace nuevo se enseña **una vez**. No es una molestia evitable: se guarda
 * hasheado, y esa es la razón de que una base de datos filtrada no entregue los
 * compromisos de nadie. La pantalla lo dice con esas palabras en vez de dejar a
 * alguien buscándolo mañana.
 */

export interface IntegrationsLabels {
  readonly feedTitle: string;
  readonly feedDetail: string;
  readonly feedEmptyTitle: string;
  readonly feedEmptyBody: string;
  readonly feedCreate: string;
  readonly feedLabelField: string;
  readonly feedLabelPlaceholder: string;
  readonly feedRevoke: string;
  readonly feedNever: string;
  readonly feedRead: string;
  readonly feedSecretTitle: string;
  readonly feedSecretBody: string;
  readonly feedHowTo: string;
  readonly googleTitle: string;
  readonly googleDetail: string;
  readonly googleOff: string;
  readonly googleConnectCalendar: string;
  readonly googleConnectMail: string;
  readonly googleConnectBoth: string;
  readonly googleDisconnect: string;
  readonly googleMailScope: string;
  readonly googleCalendarScope: string;
  readonly googleBroken: string;
  readonly googleNotMine: string;
  readonly errorTitle: string;
  readonly errors: Readonly<Record<string, string>>;
}

export interface IntegrationsPanelProps {
  readonly locale: string;
  readonly configured: boolean;
  readonly feeds: readonly {
    readonly id: string;
    readonly label: string | null;
    readonly hint: string;
    readonly lastRead: string | null;
    readonly readCount: number;
  }[];
  readonly connections: readonly {
    readonly id: string;
    readonly googleEmail: string;
    readonly capabilities: readonly ('mail' | 'calendar')[];
    readonly status: 'active' | 'revoked' | 'error';
    readonly isMine: boolean;
  }[];
  readonly labels: IntegrationsLabels;
}

export function IntegrationsPanel({
  locale,
  configured,
  feeds,
  connections,
  labels,
}: IntegrationsPanelProps) {
  const [created, createAction, creating] = useActionState<RecordActionResult, FormData>(
    createCalendarFeed,
    {},
  );

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <div>
          <h3 className="text-base font-medium">{labels.feedTitle}</h3>
          <p className="mt-1 max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
            {labels.feedDetail}
          </p>
        </div>

        {created.error && (
          <Problem
            title={labels.errorTitle}
            body={labels.errors[created.error] ?? labels.errors['generic'] ?? ''}
          />
        )}

        {/* Una vez y no más: lo que se guarda es el hash. */}
        {created.secret && (
          <Card tone="sunk">
            <p className="font-medium">{labels.feedSecretTitle}</p>
            <p className="mt-1 text-sm text-pretty text-[color:var(--color-ink-secondary)]">
              {labels.feedSecretBody}
            </p>
            <code className="mt-3 block overflow-x-auto rounded-md bg-[color:var(--color-surface-sunk)] px-3 py-2 text-xs break-all">
              {created.secret}
            </code>
            <p className="mt-3 text-sm text-pretty text-[color:var(--color-ink-secondary)]">
              {labels.feedHowTo}
            </p>
          </Card>
        )}

        {feeds.length === 0 ? (
          <EmptyState title={labels.feedEmptyTitle} body={labels.feedEmptyBody} />
        ) : (
          <Card>
            <ul className="flex list-none flex-col p-0">
              {feeds.map((feed) => (
                <li
                  key={feed.id}
                  className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[color:var(--color-rule)] py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-medium">
                      {feed.label ?? `…${feed.hint}`}
                    </span>
                    <span className="mt-1 block text-xs text-[color:var(--color-ink-secondary)]">
                      {feed.lastRead
                        ? labels.feedRead
                            .replace('{when}', feed.lastRead)
                            .replace('{count}', String(feed.readCount))
                        : labels.feedNever}
                    </span>
                  </div>
                  <Revoke locale={locale} id={feed.id} labels={labels} />
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <form action={createAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="locale" value={locale} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label
                htmlFor="feed-label"
                className="text-xs font-medium tracking-(--tracking-label) text-[color:var(--color-ink-tertiary)] uppercase"
              >
                {labels.feedLabelField}
              </label>
              <input
                id="feed-label"
                name="label"
                maxLength={60}
                placeholder={labels.feedLabelPlaceholder}
                className="w-full rounded-md border border-[color:var(--color-rule)] bg-[color:var(--color-surface)] px-3 py-2 text-sm"
              />
            </div>
            <Button type="submit" disabled={creating}>
              {labels.feedCreate}
            </Button>
          </form>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h3 className="text-base font-medium">{labels.googleTitle}</h3>
          <p className="mt-1 max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
            {labels.googleDetail}
          </p>
        </div>

        {!configured ? (
          // Apagado por configuración del despliegue, y se dice cuál. Un botón
          // deshabilitado sin motivo deja a alguien pulsándolo.
          <Problem title={labels.googleTitle} body={labels.googleOff} />
        ) : connections.length === 0 ? (
          <Card>
            {/* Tres formularios GET y no tres enlaces: el botón es el mismo
                objeto que en el resto del producto —mismo alto, mismo foco,
                misma área táctil— y la ruta sigue siendo una navegación normal,
                que es lo que el consentimiento de Google necesita. */}
            <div className="flex flex-wrap gap-3">
              <Connect locale={locale} capabilities={['calendar']}>
                {labels.googleConnectCalendar}
              </Connect>
              <Connect locale={locale} capabilities={['mail']} variant="secondary">
                {labels.googleConnectMail}
              </Connect>
              <Connect locale={locale} capabilities={['mail', 'calendar']} variant="ghost">
                {labels.googleConnectBoth}
              </Connect>
            </div>
            <p className="mt-4 max-w-[68ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
              {labels.googleMailScope}
            </p>
          </Card>
        ) : (
          <Card>
            <ul className="flex list-none flex-col p-0">
              {connections.map((connection) => (
                <li
                  key={connection.id}
                  className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[color:var(--color-rule)] py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-medium break-all">{connection.googleEmail}</span>
                    <span className="mt-1 flex flex-wrap gap-3">
                      {connection.capabilities.includes('mail') && (
                        <Status tone="neutral">{labels.googleMailScope}</Status>
                      )}
                      {connection.capabilities.includes('calendar') && (
                        <Status tone="neutral">{labels.googleCalendarScope}</Status>
                      )}
                      {connection.status !== 'active' && (
                        <Status tone="caution">{labels.googleBroken}</Status>
                      )}
                    </span>
                  </div>
                  {connection.isMine ? (
                    <Disconnect locale={locale} labels={labels} />
                  ) : (
                    <span className="text-xs text-[color:var(--color-ink-tertiary)]">
                      {labels.googleNotMine}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}

function Revoke({
  locale,
  id,
  labels,
}: {
  readonly locale: string;
  readonly id: string;
  readonly labels: IntegrationsLabels;
}) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    revokeCalendarFeed,
    {},
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {labels.feedRevoke}
      </Button>
      {state.error && (
        <span className="text-xs text-[color:var(--color-negative)]">
          {labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
        </span>
      )}
    </form>
  );
}

function Disconnect({
  locale,
  labels,
}: {
  readonly locale: string;
  readonly labels: IntegrationsLabels;
}) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(
    disconnectGoogle,
    {},
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="locale" value={locale} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {labels.googleDisconnect}
      </Button>
      {state.error && (
        <span className="text-xs text-[color:var(--color-negative)]">
          {labels.errors[state.error] ?? labels.errors['generic'] ?? ''}
        </span>
      )}
    </form>
  );
}

/**
 * Un botón que empieza el consentimiento de Google.
 *
 * `GET` porque la ruta de inicio redirige a Google y la vuelta tiene que ser una
 * navegación de arriba — es lo que permite que la cookie de `state` viaje con
 * `sameSite=lax`, que es la protección de todo este flujo.
 */
function Connect({
  locale,
  capabilities,
  variant = 'primary',
  children,
}: {
  readonly locale: string;
  readonly capabilities: readonly ('mail' | 'calendar')[];
  readonly variant?: 'primary' | 'secondary' | 'ghost';
  readonly children: React.ReactNode;
}) {
  return (
    <form action="/api/google/start" method="get">
      <input type="hidden" name="locale" value={locale} />
      {capabilities.map((capability) => (
        <input key={capability} type="hidden" name="capability" value={capability} />
      ))}
      <Button type="submit" variant={variant}>
        {children}
      </Button>
    </form>
  );
}
