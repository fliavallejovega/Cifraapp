/**
 * Splits `units` across `weights` so the parts add back to exactly `units`.
 *
 * Largest remainder (Hamilton): every part gets the floor of its exact share,
 * and the units left over go one each to the parts with the largest
 * fractional remainder, ties broken by position. The same method as
 * `Money.allocate` in `@app/domain`, here over plain integers so it works for
 * any currency, including the ones with no decimals.
 *
 * Zero weights receive zero. All-zero weights cannot carry a positive amount
 * and throw, because silently dropping money is the one failure this function
 * exists to prevent.
 */
export function allocateUnits(units: bigint, weights: readonly bigint[]): bigint[] {
  if (units < 0n) throw new RangeError('allocateUnits() cannot split a negative amount.');
  if (weights.some((weight) => weight < 0n)) {
    throw new RangeError('allocateUnits() weights must be non-negative.');
  }
  const weightSum = weights.reduce((a, b) => a + b, 0n);
  if (weightSum === 0n) {
    if (units === 0n) return weights.map(() => 0n);
    throw new RangeError('allocateUnits() cannot split an amount over all-zero weights.');
  }

  const parts = weights.map((weight) => (units * weight) / weightSum);
  const remainders = weights.map((weight, index) => ({
    index,
    rest: (units * weight) % weightSum,
  }));
  let left = units - parts.reduce((a, b) => a + b, 0n);

  remainders.sort((a, b) => (a.rest === b.rest ? a.index - b.index : a.rest > b.rest ? -1 : 1));
  for (const { index } of remainders) {
    if (left === 0n) break;
    if ((weights[index] ?? 0n) === 0n) continue;
    parts[index] = (parts[index] ?? 0n) + 1n;
    left -= 1n;
  }
  return parts;
}
