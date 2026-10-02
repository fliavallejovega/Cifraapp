/**
 * Ways to get from one fixed point of a trip to the next, as a person who
 * knows the region would suggest them. A corridor is a list of night-stops,
 * each with the places passed on the way to it. Between the same two points
 * there can be several corridors; one is the default and the others are
 * picked when a wish matches their tags.
 *
 * `priority` decides what goes first when the dates are too short: lower is
 * dropped first. A stop the person asked for by name is never dropped
 * silently — the plan says what it cost.
 */

export interface CorridorStop {
  /** Overnight place. */
  readonly placeId: string;
  /** Places passed on the way here from the previous stop, in order. */
  readonly via: readonly string[];
  readonly priority: number;
}

export interface Corridor {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly default: boolean;
  /** Matched against wish tags. */
  readonly tags: readonly string[];
  readonly stops: readonly CorridorStop[];
  /** Places passed between the last stop and `to`. */
  readonly viaToEnd: readonly string[];
}

export const CORRIDORS: readonly Corridor[] = [
  {
    id: 'venezia-arosa-lagos',
    from: 'venezia',
    to: 'arosa',
    default: true,
    tags: ['lagos', 'ciudades'],
    stops: [
      { placeId: 'verona', via: [], priority: 2 },
      { placeId: 'como', via: [], priority: 2 },
    ],
    viaToEnd: ['maloja', 'julier'],
  },
  {
    id: 'venezia-arosa-dolomitas',
    from: 'venezia',
    to: 'arosa',
    default: false,
    tags: ['dolomitas', 'montañas', 'nieve', 'pasos de montaña'],
    stops: [
      { placeId: 'cortina', via: [], priority: 3 },
      { placeId: 'canazei', via: ['falzarego', 'pordoi'], priority: 3 },
      { placeId: 'bolzano', via: ['sella', 'ortisei'], priority: 2 },
    ],
    viaToEnd: ['merano', 'reschen', 'stanton', 'chur'],
  },
  {
    id: 'arosa-selvanegra',
    from: 'arosa',
    to: 'hinterzarten',
    default: true,
    tags: ['cascadas', 'ciudades'],
    stops: [],
    viaToEnd: ['zurich', 'rheinfall'],
  },
  {
    id: 'selvanegra-copenhague-rin',
    from: 'hinterzarten',
    to: 'kastrup',
    default: true,
    tags: ['rin', 'ciudades', 'mercados navideños'],
    stops: [
      { placeId: 'ruedesheim', via: ['freiburg', 'heidelberg'], priority: 2 },
      { placeId: 'koeln', via: [], priority: 2 },
      { placeId: 'hamburg', via: [], priority: 1 },
    ],
    viaToEnd: ['luebeck', 'puttgarden', 'roedby'],
  },
];

/** Stretches that are crossed by boat: the route uses them, the person books them. */
export const FERRY_CROSSINGS: readonly {
  readonly from: string;
  readonly to: string;
  readonly operator: string;
}[] = [{ from: 'puttgarden', to: 'roedby', operator: 'Scandlines' }];

export function isFerry(from: string, to: string): boolean {
  return FERRY_CROSSINGS.some(
    (f) => (f.from === from && f.to === to) || (f.from === to && f.to === from),
  );
}

/** Where to sleep for an event held at a place with no beds of its own. */
export const SLEEP_NEAR: Readonly<Record<string, string>> = {
  ravenna: 'hinterzarten',
};
