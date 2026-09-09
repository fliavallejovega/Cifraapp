/**
 * Un dibujo por rubro, en el trazo del resto del producto.
 *
 * Veintiocho nombres en una lista se leen uno por uno; veintiocho nombres con
 * su dibujo se reconocen de un vistazo, que es la diferencia cuando alguien
 * está clasificando el octavo pago del mes.
 *
 * El nombre del icono viene de la base —`app.categories.icon`— y el dibujo vive
 * aquí. Esa separación es deliberada: una base de datos llena de rutas SVG hay
 * que migrarla cada vez que alguien redibuja una casa, y un rubro que alguien
 * cree a mano mañana solo necesita elegir un nombre de esta lista.
 *
 * Todos comparten trazo, grosor y caja: un producto con dos familias de iconos
 * se ve como dos productos pegados. Sin relleno y sin color propio — el color
 * de este sistema significa dinero, y un rubro no es una ganancia ni una
 * pérdida.
 */

const PATHS: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5',
  key: 'M14.5 3a6.5 6.5 0 1 0-4.6 11.1L3 21v0h3v-3h3v-3h2l1.4-1.4A6.5 6.5 0 0 0 14.5 3Zm2 4.5h.01',
  bank: 'M3 9.5 12 4l9 5.5M5 10v9m5-9v9m4-9v9m5-9v9M3 20h18',
  bolt: 'M13 3 5 13.5h6L11 21l8-10.5h-6L13 3Z',
  wrench:
    'M20 5.5a5 5 0 0 1-6.6 6.4L5.6 19.7a2 2 0 0 1-2.8-2.8l7.8-7.8A5 5 0 0 1 17 2.5l-3 3 1.5 3 3-3Z',
  basket:
    'M4 9h16l-1.6 10.2a2 2 0 0 1-2 1.8H7.6a2 2 0 0 1-2-1.8L4 9Zm4 0 2-6m6 6-2-6M9.5 13v4m5-4v4',
  cutlery: 'M6 3v8a2 2 0 0 0 4 0V3M8 11v10M18 3c-1.5 1.5-2 3-2 5.5V13h2m0 0V3m0 10v8',
  car: 'M4 13.5 5.8 8A2 2 0 0 1 7.7 6.5h8.6A2 2 0 0 1 18.2 8L20 13.5M4 13.5h16M4 13.5V19h3v-2h10v2h3v-5.5M7 16.5h.01M17 16.5h.01',
  fuel: 'M4 21V5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v16M3 21h11M5 10h7m2-2 3.5 3.5V17a2 2 0 0 0 4 0V9l-3-3',
  bus: 'M5 17V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v11M5 17h14M5 17v2.5M19 17v2.5M5 11h14M8 14h.01M16 14h.01',
  bag: 'M5 8h14l-1 12H6L5 8Zm3.5 0V6a3.5 3.5 0 0 1 7 0v2',
  play: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-2-12.5 6 3.5-6 3.5v-7Z',
  repeat:
    'M4 9.5A5.5 5.5 0 0 1 9.5 4H19m0 0-3-3m3 3-3 3M20 14.5a5.5 5.5 0 0 1-5.5 5.5H5m0 0 3 3m-3-3 3-3',
  plane: 'M10.5 20.5 12 15l7.5-2 1.5-4-8 2-4.5-6h-2l2 7-4 1.5-1.5-2h-1.5l1 4 1 4h1.5l1-2 4.5.5Z',
  heart: 'M12 20s-7.5-4.7-7.5-10A4.5 4.5 0 0 1 12 7.5 4.5 4.5 0 0 1 19.5 10c0 5.3-7.5 10-7.5 10Z',
  shield: 'M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z',
  book: 'M5 4h9a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H5V4Zm14 3h1v13H8',
  people:
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.5.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2.5 20v-1.5A4.5 4.5 0 0 1 7 14h4a4.5 4.5 0 0 1 4.5 4.5V20m1-6.5h1a4 4 0 0 1 4 4V20',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1',
  card: 'M3 7.5A2.5 2.5 0 0 1 5.5 5h13A2.5 2.5 0 0 1 21 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5v-9Zm0 3h18M6.5 15H10',
  receipt:
    'M6 3.5 7.5 5 9 3.5 10.5 5 12 3.5 13.5 5 15 3.5 16.5 5 18 3.5v17L16.5 19 15 20.5 13.5 19 12 20.5 10.5 19 9 20.5 7.5 19 6 20.5v-17ZM9 9h6m-6 3.5h6',
  percent: 'm6 18 12-12M8 9.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm8 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  briefcase:
    'M3 8.5h18V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8.5Zm6 0V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2.5M3 13h18',
  arrows: 'M4 8h13m0 0-3-3m3 3-3 3M20 16H7m0 0 3-3m-3 3 3 3',
  chart: 'M4 20V4m0 16h16M8 16V11m4 5V7m4 9v-3',
  piggy:
    'M4.5 12.5A6 6 0 0 1 10.5 7h4a6 6 0 0 1 5.6 4l1.4.5v3l-1.6.4a6 6 0 0 1-2.4 2.6V20h-3v-1.2h-3V20h-3v-2.5a6 6 0 0 1-2-4H4a1.5 1.5 0 0 1 0-3h.5ZM16 11.5h.01M10.5 7V5.5',
  wallet:
    'M4 7.5A2.5 2.5 0 0 1 6.5 5H18v2.5M4 7.5V17a2.5 2.5 0 0 0 2.5 2.5H19a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H4Zm12.5 5.5h.01',
  // El sol sobre el horizonte: dejar de trabajar dibujado sin un reloj ni una
  // silla, que es como se dibuja normalmente y como se lee mal.
  retire: 'M3 19h18M6.5 19a5.5 5.5 0 0 1 11 0M12 5v3m6-1-2 2M6 7l2 2m-6 4h2m18 0h-2',
  tag: 'M4 4h7.5L20 12.5 12.5 20 4 11.5V4Zm3.5 3.5h.01',
};

export function CategoryIcon({
  name,
  className,
}: {
  readonly name: string | null | undefined;
  readonly className?: string;
}) {
  // Un rubro sin icono —o con uno que este build no conoce todavía— cae en la
  // etiqueta genérica en vez de dejar un hueco. El hueco se nota; el rubro sin
  // dibujo particular, no.
  const path = (name && PATHS[name]) ?? PATHS['tag'];

  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={className ?? 'h-4 w-4 shrink-0'}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}
