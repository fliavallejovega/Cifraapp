'use client';

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';

/**
 * El menú en teléfono: no se superpone, se REVELA.
 *
 * Vendorizado de `cajon-revelado` y adaptado a este producto: los colores salen
 * de los tokens del sistema (panel de tinta profunda, acento de latón) y las
 * entradas admiten un pie — el hogar y el cierre de sesión viven al fondo del
 * menú, como en la columna de escritorio.
 *
 * El menú está siempre debajo, a pantalla completa, y lo que se mueve es la
 * página: se encoge, se redondea y se desplaza hasta dejar el menú a la vista,
 * como una carta que se aparta.
 *
 * POR QUÉ ESTO ENVUELVE A TODA LA PÁGINA. Para apartarla hay que poder
 * transformarla entera, y eso solo se puede desde un elemento que la contenga.
 * Cabecera, columnas y contenido se mueven juntos, que es lo que hace creíble
 * que sea una sola superficie.
 *
 * LO QUE HAY QUE REPONER A MANO (no es un `<dialog>`, porque un diálogo no
 * puede transformar la página que lo contiene): Escape cierra; el fondo se
 * vuelve inerte con `inert`; el foco entra al menú al abrir y vuelve al botón
 * al cerrar; y la franja de página visible es un botón de verdad FUERA de la
 * zona inerte, porque dentro `inert` se comería el toque.
 */

export interface EntradaDelCajon {
  href: string;
  titulo: string;
  /** Bloque al que pertenece. Las entradas sin grupo van juntas y sin encabezado. */
  grupo?: string;
  descripcion?: string;
  /** Icono ya renderizado. Se dibuja a 18 px por CSS. */
  icono?: ReactNode;
}

export interface PropiedadesDeEnlace {
  href: string;
  title?: string | undefined;
  'aria-current'?: 'page' | undefined;
  className?: string;
  onClick?: (() => void) | undefined;
  children: ReactNode;
}

export interface PropiedadesDelCajon {
  entradas: EntradaDelCajon[];
  rutaActual: string;
  Enlace?: ComponentType<PropiedadesDeEnlace>;
  titulo?: string;
  etiqueta?: string;
  /** Contenido fijo al pie del menú: el hogar, cerrar sesión. */
  pie?: ReactNode;
  /** La marca que encabeza la barra. Un nodo, para que el rótulo sea del producto. */
  marca?: ReactNode;
  /** Nombre accesible del botón de cerrar. Copy del catálogo, nunca fijo aquí. */
  textoCerrar: string;
  /** Nombre accesible de la franja de vuelta. */
  textoVolver: string;
  esActiva?: (rutaActual: string, href: string) => boolean;
  children: ReactNode;
}

/** Exacta, o prefijo terminado en `/`, que evita que `/casa` marque `/casamiento`. */
export function rutaActivaPorDefecto(rutaActual: string, href: string): boolean {
  return rutaActual === href || rutaActual.startsWith(`${href}/`);
}

function EnlaceSimple({ href, children, ...resto }: PropiedadesDeEnlace) {
  return (
    <a href={href} {...resto}>
      {children}
    </a>
  );
}

export function CajonRevelado({
  entradas,
  rutaActual,
  Enlace = EnlaceSimple,
  titulo = 'Menú',
  etiqueta,
  pie,
  marca,
  textoCerrar,
  textoVolver,
  esActiva = rutaActivaPorDefecto,
  children,
}: PropiedadesDelCajon) {
  const [abierto, setAbierto] = useState(false);
  const disparador = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);

  const bloques = agrupar(entradas);
  const actual = entradas.find((e) => esActiva(rutaActual, e.href));

  // Al cambiar de ruta el menú sobra: se navegó, que es a lo que se venía.
  useEffect(() => {
    setAbierto(false);
  }, [rutaActual]);

  useEffect(() => {
    if (!abierto) return;

    const conEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false);
    };
    document.addEventListener('keydown', conEscape);

    // El cuerpo deja de desplazarse mientras el menú está abierto; si no, el
    // dedo sobre el menú scrollea la página de debajo.
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    panel.current?.focus();

    return () => {
      document.removeEventListener('keydown', conEscape);
      document.body.style.overflow = anterior;
    };
  }, [abierto]);

  function cerrar() {
    setAbierto(false);
    disparador.current?.focus();
  }

  return (
    <div className="cajon" data-abierto={abierto}>
      <nav
        ref={panel}
        tabIndex={-1}
        aria-label={etiqueta ?? titulo}
        aria-hidden={!abierto}
        className="cajon-menu"
      >
        <div className="cajon-cabecera">
          <p className="cajon-titulo">{titulo}</p>
          <button type="button" onClick={cerrar} className="cajon-cerrar">
            <span className="cajon-solo-lectores">{textoCerrar}</span>
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              width="16"
              height="16"
            >
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div className="cajon-lista">
          {bloques.map((b, i) => (
            <div
              key={b.grupo ?? '__sueltas__'}
              className="cajon-grupo"
              /* Los bloques entran escalonados: hay una secuencia que leer y el
                 escalonado la ordena en vez de soltarla toda de golpe. */
              style={{ ['--cajon-retraso' as string]: `${String(60 + i * 45)}ms` }}
            >
              {b.grupo ? <h2 className="cajon-grupo-titulo">{b.grupo}</h2> : null}
              <ul>
                {b.entradas.map((e) => (
                  <li key={e.href}>
                    <Enlace
                      href={e.href}
                      title={e.descripcion}
                      aria-current={esActiva(rutaActual, e.href) ? 'page' : undefined}
                      className="cajon-entrada"
                      onClick={() => {
                        setAbierto(false);
                      }}
                    >
                      {e.icono}
                      {e.titulo}
                    </Enlace>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {pie ? <div className="cajon-pie">{pie}</div> : null}
      </nav>

      {/* La página. Se aparta cuando el menú se abre, y mientras tanto es
          inerte: ni se tabula ni se toca. */}
      <div className="cajon-lienzo" {...(abierto ? { inert: true } : {})}>
        <div className="cajon-barra">
          <button
            ref={disparador}
            type="button"
            onClick={() => {
              setAbierto(true);
            }}
            aria-expanded={abierto}
            className="cajon-abrir"
          >
            <span className="cajon-solo-lectores">{titulo}</span>
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              width="16"
              height="16"
            >
              <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
            </svg>
          </button>
          {marca}
          {actual ? <p className="cajon-donde-estoy">{actual.titulo}</p> : null}
        </div>

        {children}
      </div>

      {/* La franja de página visible es un botón de cierre de verdad, FUERA del
          lienzo inerte. Solo existe con el menú abierto. */}
      {abierto ? (
        <button type="button" onClick={cerrar} className="cajon-volver" aria-label={textoVolver} />
      ) : null}
    </div>
  );
}

/** Agrupa conservando el orden en que aparecen los grupos. */
function agrupar(
  entradas: EntradaDelCajon[],
): { grupo: string | undefined; entradas: EntradaDelCajon[] }[] {
  const orden: (string | undefined)[] = [];
  const porGrupo = new Map<string | undefined, EntradaDelCajon[]>();

  for (const e of entradas) {
    const lista = porGrupo.get(e.grupo);
    if (lista) {
      lista.push(e);
    } else {
      porGrupo.set(e.grupo, [e]);
      orden.push(e.grupo);
    }
  }

  return orden.map((grupo) => ({ grupo, entradas: porGrupo.get(grupo) ?? [] }));
}
