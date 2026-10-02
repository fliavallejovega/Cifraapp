import type { PlainDate } from '@app/domain';

import type { ZonedTime } from './types.js';
import { fromInstant } from './zoned.js';

/**
 * Sunrise and sunset from date and coordinates, after the NOAA solar
 * calculator (Meeus, «Astronomical Algorithms»). Accurate to about a minute
 * at the latitudes this product plans for, which is more than a driving plan
 * needs: the point is to keep mountain driving out of the dark, not to time
 * a photograph.
 *
 * Returns `null` for a day with no sunrise or no sunset (polar night or day).
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

function julianDay(date: PlainDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / 86_400_000 + 2_440_587.5;
}

/** Minutes after UTC midnight of the event, or null when the sun does not cross. */
function eventUtcMinutes(
  date: PlainDate,
  lat: number,
  lon: number,
  rising: boolean,
): number | null {
  const jd = julianDay(date);
  // Two iterations: the second evaluates the sun's position at the event itself.
  let minutes = 720;
  for (let i = 0; i < 2; i++) {
    const t = (jd + minutes / 1440 - 2_451_545) / 36_525;
    const l0 = (280.46646 + t * (36_000.76983 + t * 0.0003032)) % 360;
    const mAnom = 357.52911 + t * (35_999.05029 - 0.0001537 * t);
    const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
    const c =
      Math.sin(mAnom * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
      Math.sin(2 * mAnom * RAD) * (0.019993 - 0.000101 * t) +
      Math.sin(3 * mAnom * RAD) * 0.000289;
    const trueLong = l0 + c;
    const omega = 125.04 - 1934.136 * t;
    const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
    const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
    const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
    const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) * DEG;
    const y = Math.tan((eps / 2) * RAD) ** 2;
    const eqTime =
      4 *
      DEG *
      (y * Math.sin(2 * l0 * RAD) -
        2 * e * Math.sin(mAnom * RAD) +
        4 * e * y * Math.sin(mAnom * RAD) * Math.cos(2 * l0 * RAD) -
        0.5 * y * y * Math.sin(4 * l0 * RAD) -
        1.25 * e * e * Math.sin(2 * mAnom * RAD));
    const cosH =
      Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(decl * RAD)) -
      Math.tan(lat * RAD) * Math.tan(decl * RAD);
    if (cosH > 1 || cosH < -1) return null;
    const hourAngle = Math.acos(cosH) * DEG;
    const solarNoon = 720 - 4 * lon - eqTime;
    minutes = rising ? solarNoon - 4 * hourAngle : solarNoon + 4 * hourAngle;
  }
  return minutes;
}

function asZoned(date: PlainDate, utcMinutes: number, timeZone: string): ZonedTime {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return fromInstant(Date.UTC(y, m - 1, d) + Math.round(utcMinutes) * 60_000, timeZone);
}

export interface SunTimes {
  readonly sunrise: ZonedTime;
  readonly sunset: ZonedTime;
}

/** Local sunrise and sunset at a place on a calendar day. */
export function sunTimes(
  date: PlainDate,
  lat: number,
  lon: number,
  timeZone: string,
): SunTimes | null {
  const rise = eventUtcMinutes(date, lat, lon, true);
  const set = eventUtcMinutes(date, lat, lon, false);
  if (rise === null || set === null) return null;
  return { sunrise: asZoned(date, rise, timeZone), sunset: asZoned(date, set, timeZone) };
}
