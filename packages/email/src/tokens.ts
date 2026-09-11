/**
 * El sistema de diseño, traducido a lo que un cliente de correo entiende.
 *
 * ## Por qué hex y no las variables del producto
 *
 * DESIGN.md define los colores en OKLCH y los expone como variables CSS. Ningún
 * cliente de correo relevante entiende ninguna de las dos cosas: Gmail descarta
 * las variables y Outlook no sabe qué es OKLCH. Cada valor de abajo es la
 * conversión exacta a sRGB del token del mismo nombre en
 * `packages/ui/src/styles`, así que un correo y una pantalla muestran el mismo
 * marfil y la misma tinta.
 *
 * ## Dos mundos, un metal
 *
 * Marfil para el papel, tinta para el panel, y el latón sólo en la marca. En un
 * correo eso significa que el botón va en tinta y no en latón: DESIGN.md raciona
 * el latón a la marca, una marca activa y una lectura principal por pantalla, y
 * un botón no es ninguna de las tres.
 */

export interface EmailPalette {
  readonly ground: string;
  readonly groundSunk: string;
  readonly surface: string;
  readonly surfaceBorder: string;
  readonly ink: string;
  readonly inkSecondary: string;
  readonly inkTertiary: string;
  readonly rule: string;
  readonly brand: string;
  readonly brandStrong: string;
  readonly panel: string;
  readonly panelInk: string;
  readonly positive: string;
  readonly negative: string;
  readonly caution: string;
}

/** El claro es el de fábrica: la escena de uso es un escritorio de día. */
export const LIGHT: EmailPalette = {
  ground: '#F9F7F3',
  groundSunk: '#F1EFEA',
  surface: '#FEFDFC',
  surfaceBorder: '#E4E1DB',
  ink: '#151D2A',
  inkSecondary: '#4C535E',
  inkTertiary: '#6C727B',
  rule: '#E4E1DB',
  brand: '#B98935',
  brandStrong: '#996605',
  panel: '#101A29',
  panelInk: '#F4F1ED',
  positive: '#006A3E',
  negative: '#B1262A',
  caution: '#955900',
};

/**
 * El oscuro, para los clientes que respetan `prefers-color-scheme`.
 *
 * Diseñado y no derivado, como en el producto: el botón deja de ser tinta sobre
 * papel —se perdería contra un fondo casi negro— y pasa a ser marfil sobre
 * tinta.
 */
export const DARK: EmailPalette = {
  ground: '#080F18',
  groundSunk: '#040810',
  surface: '#111924',
  surfaceBorder: '#232C38',
  ink: '#F0EEEA',
  inkSecondary: '#AEAAA2',
  inkTertiary: '#8A867E',
  rule: '#1F2732',
  brand: '#D5AA55',
  brandStrong: '#E9C57D',
  panel: '#F4F1ED',
  panelInk: '#101A29',
  positive: '#40C786',
  negative: '#F2716A',
  caution: '#E8AA4E',
};

/**
 * Las dos familias del producto, con respaldo real.
 *
 * Archivo y Chivo Mono se cargan desde Google Fonts, y la mayoría de los
 * clientes —Gmail entre ellos— las ignora. El respaldo no es un detalle: es la
 * tipografía que va a ver casi todo el mundo, así que se eligió por métrica
 * parecida y no por costumbre.
 */
export const FONT_SANS =
  "Archivo, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Para montos y códigos: cifras tabulares, como en cada columna del producto. */
export const FONT_MONO =
  "'Chivo Mono', ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace";

export const FONT_LINK =
  'https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=Chivo+Mono:wght@400;500&display=swap';

/** El ancho del cuerpo. 560 deja margen en los 600 que casi todo cliente respeta. */
export const CONTENT_WIDTH = 560;
