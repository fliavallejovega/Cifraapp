/**
 * Risk levels, as assumptions rather than forecasts.
 *
 * This is the line the whole package is built on. A number like «7% a year» is
 * not a prediction anybody is entitled to make; it is a *band* observed over
 * long periods for a *kind* of holding, and the honest thing is to show the
 * band, name where it came from, and let the household change it.
 *
 * So every level carries three rates — a poor decade, a middling one, a good
 * one — and every figure the engine produces is a range built from all three.
 * A single number would be read as a promise, and this product does not make
 * promises about markets.
 *
 * The levels name **asset mixes, not instruments**. Which fund or which bond is
 * a recommendation, and a recommendation is regulated advice; how much of a
 * mix sits in cash, in bonds and in broad equity is a description of risk that
 * anybody can check.
 */

export type RiskLevel = 'cash' | 'conservative' | 'balanced' | 'growth';

export interface RiskBand {
  readonly level: RiskLevel;
  /** Whole percent a year, as decimal strings. Assumptions, not forecasts. */
  readonly low: string;
  readonly expected: string;
  readonly high: string;
  /** How much of the mix is not cash or bonds. Drives the warning copy. */
  readonly equityShare: number;
  /** The worst peak-to-trough fall a mix of this shape has historically seen. */
  readonly historicalDrawdown: number;
  /** Below this horizon the level is the wrong tool, whatever the arithmetic. */
  readonly minimumHorizonMonths: number;
}

/**
 * The default bands.
 *
 * Deliberately wide and deliberately round. Precision here would be false: the
 * spread between a good and a bad decade dwarfs any refinement, and a band of
 * `4.0%–7.2%` implies a measurement nobody made.
 *
 * A household can override any of them, and the screen shows that these are the
 * product's assumptions rather than its knowledge.
 */
export const DEFAULT_BANDS: Readonly<Record<RiskLevel, RiskBand>> = {
  cash: {
    level: 'cash',
    low: '0',
    expected: '2',
    high: '4',
    equityShare: 0,
    historicalDrawdown: 0,
    minimumHorizonMonths: 0,
  },
  conservative: {
    level: 'conservative',
    low: '1',
    expected: '4',
    high: '6',
    equityShare: 0.2,
    historicalDrawdown: 10,
    minimumHorizonMonths: 12,
  },
  balanced: {
    level: 'balanced',
    low: '0',
    expected: '6',
    high: '9',
    equityShare: 0.55,
    historicalDrawdown: 30,
    minimumHorizonMonths: 36,
  },
  growth: {
    level: 'growth',
    low: '-2',
    expected: '8',
    high: '12',
    equityShare: 0.9,
    historicalDrawdown: 50,
    minimumHorizonMonths: 60,
  },
};

export const RISK_LEVELS: readonly RiskLevel[] = ['cash', 'conservative', 'balanced', 'growth'];

/**
 * Whether a level is defensible for a horizon.
 *
 * Money needed in eighteen months does not belong in something that has
 * historically fallen half its value, whatever the expected return says. The
 * engine reports this rather than silently refusing: the household decides, and
 * the screen tells them what they are deciding.
 */
export function suitsHorizon(band: RiskBand, horizonMonths: number): boolean {
  return horizonMonths >= band.minimumHorizonMonths;
}
