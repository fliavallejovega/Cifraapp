'use client';

import { useEffect, useState } from 'react';

import { cn } from '../utils/cn';

/**
 * Cuánto del cupo se lleva usado, de un vistazo.
 *
 * La utilización es la cifra que nadie mira hasta que ya está alta. Vive fuera
 * del panel de gestión a propósito: quien abre la pantalla de tarjetas viene a
 * preguntarse cuánto le queda, y esconder la respuesta detrás de un botón
 * convierte la pregunta más frecuente en la que más cuesta contestar.
 *
 * ## Las bandas y de dónde salen
 *
 * 30% y 70% no son invención de este producto: 30% es el umbral por encima del
 * cual la utilización empieza a pesar en un puntaje de crédito, y por encima de
 * 70% un emisor la lee como señal de estrés. Que sean prestadas importa —
 * significa que la barra reporta algo medible y no una opinión sobre el gasto
 * de la casa.
 *
 * ## Por qué la barra se llena
 *
 * Porque el ojo detecta movimiento antes que color, y el crecimiento desde cero
 * dice «esto es una proporción» sin una palabra. Es una sola vez, al aparecer,
 * y nunca en bucle: una barra que late convierte un dato en una alarma, y
 * cuatro tarjetas latiendo a destiempo son ruido. Con `prefers-reduced-motion`
 * la regla global del sistema la deja quieta en su valor final — el dato nunca
 * depende de la animación.
 *
 * ## El color no viaja solo
 *
 * Cada banda lleva su palabra al lado. Quien no distingue el ámbar del rojo
 * tiene que poder leer lo mismo, y en una cifra que decide si conviene usar la
 * tarjeta este mes eso no es un detalle de accesibilidad: es la información.
 */

export type UtilizationBand = 'comfortable' | 'tight' | 'stretched';

export interface UtilizationBarProps {
  /** Lo usado sobre el cupo, de 0 a 1. Por encima de 1 la barra se llena y lo dice. */
  readonly ratio: number;
  readonly band: UtilizationBand;
  /** Nombre accesible. Una barra sin nombre no se puede leer en voz alta. */
  readonly label: string;
  /** El texto ya armado que la acompaña: «Te quedan $1,240 de $2,600». */
  readonly caption: string;
  /** La palabra de la banda: «Holgada», «Apretada», «Al límite». */
  readonly bandLabel: string;
  /** El nombre de la marca del 30%, para la lista de referencia. */
  readonly thresholdLabel?: string;
  /** Qué se lee en voz alta en vez del número crudo. */
  readonly valueText: string;
  readonly className?: string;
}

const FILL: Record<UtilizationBand, string> = {
  comfortable: 'var(--color-positive)',
  tight: 'var(--color-caution)',
  stretched: 'var(--color-negative)',
};

const WORD: Record<UtilizationBand, string> = {
  comfortable: 'text-[color:var(--color-positive)]',
  tight: 'text-[color:var(--color-caution)]',
  stretched: 'text-[color:var(--color-negative)]',
};

/** La marca del 30%: donde la utilización empieza a pesar en un puntaje. */
const THRESHOLD = 0.3;

export function UtilizationBar({
  ratio,
  band,
  label,
  caption,
  bandLabel,
  thresholdLabel,
  valueText,
  className,
}: UtilizationBarProps) {
  // Arranca en cero y crece al montar. El estado inicial es el mismo que el
  // servidor renderiza, así que no hay salto de hidratación.
  const [grown, setGrown] = useState(false);

  useEffect(() => {
    // Dos cuadros: uno para que el navegador pinte el cero, otro para que la
    // transición tenga desde dónde salir. Con uno solo el cambio se agrupa con
    // el pintado inicial y la barra aparece llena.
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setGrown(true);
      });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, []);

  // Por encima del cupo la barra se llena y no se desborda: el exceso ya lo
  // dice la palabra de la banda y el texto que la acompaña.
  const clamped = Math.min(1, Math.max(0, ratio));

  return (
    <div className={cn('w-full', className)}>
      <div
        role="meter"
        aria-label={label}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={valueText}
        className={cn(
          'relative h-2 w-full overflow-hidden rounded-(--radius-xs)',
          'border border-[color:var(--color-rule)]',
          'bg-[color:var(--color-ground-sunk)]',
        )}
      >
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 rounded-(--radius-xs) transition-[width,background-color] duration-(--duration-settle) ease-(--ease-settle)"
          style={{
            width: `${String((grown ? clamped : 0) * 100)}%`,
            backgroundColor: FILL[band],
          }}
        />

        {/* La marca del 30%, encima del relleno para que sobreviva a cruzarla. */}
        <div
          aria-hidden
          className="absolute inset-y-0 w-px bg-[color:var(--color-rule-strong)]"
          style={{ left: `${String(THRESHOLD * 100)}%` }}
        />
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className={cn('font-medium', WORD[band])}>{bandLabel}</span>
        <span className="text-[color:var(--color-ink-secondary)]">{caption}</span>
        {thresholdLabel && (
          <span className="text-xs text-[color:var(--color-ink-tertiary)]">{thresholdLabel}</span>
        )}
      </p>
    </div>
  );
}
