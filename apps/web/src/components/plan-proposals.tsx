'use client';

import { Button, Card, EmptyState, Problem, Status } from '@app/ui';
import { useActionState } from 'react';

import { applyProposal, proposePlanChange, rejectProposal } from '@/server/proposal-actions';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * Lo que el copiloto propuso, esperando una decisión.
 *
 * Dos botones y ninguna ambigüedad sobre cuál es cuál: **aprobar** es la acción
 * principal y dice qué va a cambiar —«Poner el piso en $1,000»— en vez de decir
 * «Aceptar». Un botón que no adelanta su resultado en una pantalla que mueve
 * dinero es un botón que se pulsa sin leer.
 *
 * La frase del modelo va debajo, en gris, marcada como suya. Es lo único de esta
 * tarjeta que escribió un modelo, y separarlo visualmente de la descripción
 * —que la construyó código determinista a partir de la fila— es lo que permite
 * leerla con la desconfianza que merece.
 *
 * No hay «aprobar todo». Cinco cambios aprobados de un clic son cinco cambios
 * que nadie leyó.
 */

export interface ProposalRow {
  readonly id: string;
  /** Qué haría, escrito por código determinista a partir de la fila. */
  readonly description: string;
  /** La frase del modelo. Lo único que no salió de una fila. */
  readonly reason: string;
}

export interface PlanProposalsProps {
  readonly locale: string;
  readonly proposals: readonly ProposalRow[];
  readonly labels: {
    readonly title: string;
    readonly detail: string;
    readonly emptyTitle: string;
    readonly emptyBody: string;
    readonly modelSays: string;
    readonly approve: string;
    readonly reject: string;
    readonly composerLabel: string;
    readonly composerPlaceholder: string;
    readonly composerSubmit: string;
    readonly pending: string;
    readonly errorTitle: string;
    readonly errors: Readonly<Record<string, string>>;
  };
}

export function PlanProposals({ locale, proposals, labels }: PlanProposalsProps) {
  const [asked, askAction, asking] = useActionState<RecordActionResult, FormData>(
    proposePlanChange,
    {},
  );

  return (
    <div className="flex flex-col gap-4">
      {asked.error && (
        <Problem
          title={labels.errorTitle}
          body={labels.errors[asked.error] ?? labels.errors['generic'] ?? ''}
        />
      )}

      {proposals.length === 0 ? (
        <EmptyState title={labels.emptyTitle} body={labels.emptyBody} />
      ) : (
        <ul className="flex list-none flex-col gap-3 p-0">
          {proposals.map((proposal) => (
            <li key={proposal.id}>
              <Card>
                <p className="font-medium text-pretty">{proposal.description}</p>
                <p className="mt-2 text-sm text-pretty text-[color:var(--color-ink-secondary)]">
                  <Status tone="signal">{labels.modelSays}</Status>{' '}
                  <span className="ml-1">{proposal.reason}</span>
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Decision
                    locale={locale}
                    id={proposal.id}
                    action={applyProposal}
                    label={labels.approve}
                    variant="primary"
                    errorTitle={labels.errorTitle}
                    errors={labels.errors}
                  />
                  <Decision
                    locale={locale}
                    id={proposal.id}
                    action={rejectProposal}
                    label={labels.reject}
                    variant="ghost"
                    errorTitle={labels.errorTitle}
                    errors={labels.errors}
                  />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Card>
        <form action={askAction} className="flex flex-col gap-3">
          <input type="hidden" name="locale" value={locale} />
          <label
            htmlFor="proposal-request"
            className="text-xs font-medium tracking-(--tracking-label) text-[color:var(--color-ink-tertiary)] uppercase"
          >
            {labels.composerLabel}
          </label>
          <textarea
            id="proposal-request"
            name="request"
            rows={2}
            required
            minLength={3}
            maxLength={500}
            placeholder={labels.composerPlaceholder}
            className="w-full resize-y rounded-md border border-[color:var(--color-rule)] bg-[color:var(--color-surface)] px-3 py-2 text-sm leading-relaxed"
          />
          <div>
            <Button type="submit" disabled={asking}>
              {asking ? labels.pending : labels.composerSubmit}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

/**
 * Un botón que decide, con su propio estado.
 *
 * Cada uno lleva su formulario porque cada uno manda un identificador distinto y
 * porque el error de aprobar tiene que salir junto al que se pulsó — un error
 * global sobre una lista de cinco no dice cuál falló.
 */
function Decision({
  locale,
  id,
  action,
  label,
  variant,
  errorTitle,
  errors,
}: {
  readonly locale: string;
  readonly id: string;
  readonly action: (previous: RecordActionResult, formData: FormData) => Promise<RecordActionResult>;
  readonly label: string;
  readonly variant: 'primary' | 'ghost';
  readonly errorTitle: string;
  readonly errors: Readonly<Record<string, string>>;
}) {
  const [state, formAction, pending] = useActionState<RecordActionResult, FormData>(action, {});

  return (
    <form action={formAction} className="contents">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant={variant} disabled={pending}>
        {label}
      </Button>
      {state.error && (
        <span className="w-full">
          <Problem
            title={errorTitle}
            body={errors[state.error] ?? errors['generic'] ?? ''}
          />
        </span>
      )}
    </form>
  );
}
