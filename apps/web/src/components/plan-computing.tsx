'use client';

import { useEffect, useState } from 'react';

/**
 * La espera mientras se arma el primer plan.
 *
 * Guardar el cuestionario escribe seis tablas en una transacción y después
 * calcula un plan; en una casa con veinte pagos y cuatro deudas eso es un par
 * de segundos en los que la pantalla, hasta ahora, no decía nada. Un botón que
 * gira no dice nada: dice «espera», que es lo único que ya se sabía.
 *
 * Esto dice **qué se está haciendo**, en el orden en que ocurre y con las
 * palabras del cuestionario. Los pasos no son decorativos: son los mismos que
 * la persona acaba de contestar, así que la espera se lee como el final de lo
 * que hizo y no como un cargador genérico.
 *
 * ## Por qué los símbolos caen y no giran
 *
 * Un giro no tiene principio ni final y por eso no comunica avance. Algo que
 * cae de arriba abajo sí: hay un antes y un después, y la vista lo lee como
 * trabajo que progresa aunque la duración real sea desconocida.
 *
 * ## Y por qué no hay barra de porcentaje
 *
 * Porque no se sabe el porcentaje. Una barra que avanza a una velocidad
 * inventada y se queda en el 90% es una mentira pequeña que la gente reconoce,
 * y reconocerla enseña a desconfiar de las cifras de la pantalla siguiente —
 * que en este producto son el producto.
 *
 * Respeta `prefers-reduced-motion`: sin movimiento queda el texto, que es lo
 * que de verdad informa.
 */

/** Lo que se está haciendo, en el orden en que ocurre. */
const STEPS = 4;

export function PlanComputing({
  labels,
  isDone,
}: {
  /** Los cuatro pasos y el título, resueltos en el servidor. */
  readonly labels: {
    readonly title: string;
    readonly steps: readonly string[];
    readonly done: string;
  };
  /**
   * Si el plan ya está listo.
   *
   * Dispara el acercamiento final. Llega de fuera porque quien sabe que
   * terminó es la acción del formulario, no esta animación.
   */
  readonly isDone: boolean;
}) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (isDone) return;
    // Avanza solo hasta el penúltimo: el último lo marca el resultado real. Una
    // animación que se declara terminada antes que el trabajo es la que hace
    // que alguien cierre la pestaña a mitad de una transacción.
    const timer = setInterval(() => {
      setStep((current) => Math.min(current + 1, STEPS - 2));
    }, 900);
    return () => {
      clearInterval(timer);
    };
  }, [isDone]);

  const reached = isDone ? STEPS - 1 : step;

  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        'fixed inset-0 z-50 flex flex-col items-center justify-center gap-8',
        'bg-[color:var(--color-ground)]',
        // El acercamiento: al terminar, todo crece y se desvanece, y debajo
        // queda el panel. Es el único momento del producto en que una pantalla
        // se abre hacia otra, y por eso se nota.
        'transition-[opacity,transform] duration-700 ease-(--ease-settle)',
        isDone ? 'pointer-events-none scale-125 opacity-0' : 'scale-100 opacity-100',
      ].join(' ')}
    >
      <MoneyRain />

      <div className="relative flex flex-col items-center gap-6 px-6 text-center">
        <h2
          className="text-2xl font-medium text-balance text-[color:var(--color-ink)]"
          style={{ letterSpacing: 'var(--tracking-title)' }}
        >
          {isDone ? labels.done : labels.title}
        </h2>

        <ol className="flex flex-col gap-2 text-sm">
          {labels.steps.slice(0, STEPS).map((label, at) => {
            const passed = at < reached;
            const current = at === reached;
            return (
              <li
                key={label}
                className={[
                  'flex items-center gap-3 transition-[color,opacity] duration-(--duration-settle)',
                  passed
                    ? 'text-[color:var(--color-ink-tertiary)]'
                    : current
                      ? 'font-medium text-[color:var(--color-ink)]'
                      : 'text-[color:var(--color-ink-tertiary)] opacity-50',
                ].join(' ')}
              >
                <span
                  aria-hidden
                  className={[
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-(--duration-settle)',
                    passed || current
                      ? 'border-[color:var(--color-ink)] bg-[color:var(--color-ink)] text-[color:var(--color-ground)]'
                      : 'border-[color:var(--color-rule-strong)]',
                  ].join(' ')}
                >
                  {passed ? (
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                      <path
                        d="M2.5 6.2 4.8 8.5 9.5 3.8"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : current ? (
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                  ) : null}
                </span>
                <span>{label}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/**
 * Los símbolos de moneda cayendo detrás del texto.
 *
 * Nueve columnas con retrasos y duraciones distintas, para que la lluvia no
 * tenga un patrón que el ojo pueda contar. Muy tenues a propósito: es un fondo,
 * y lo que hay que leer es lo de delante — un fondo que compite con el texto en
 * una pantalla de espera es lo que hace que la espera se sienta más larga.
 */
function MoneyRain() {
  const drops = Array.from({ length: 9 }, (_, at) => ({
    left: `${String(6 + at * 11)}%`,
    delay: `${String((at % 5) * 0.42)}s`,
    duration: `${String(3.6 + (at % 4) * 0.7)}s`,
    glyph: at % 3 === 0 ? 'B/.' : at % 3 === 1 ? '$' : '¢',
    size: at % 2 === 0 ? 'text-3xl' : 'text-xl',
  }));

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {drops.map((drop) => (
        <span
          key={drop.left}
          className={`money-drop absolute top-0 ${drop.size} font-medium text-[color:var(--color-ink)] opacity-[0.07] motion-reduce:hidden`}
          style={{
            left: drop.left,
            animationDelay: drop.delay,
            animationDuration: drop.duration,
          }}
        >
          {drop.glyph}
        </span>
      ))}
    </div>
  );
}
