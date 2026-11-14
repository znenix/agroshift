/** Calendar helpers on ISO dates ("YYYY-MM-DD") in UTC. Pure. */

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isoToUtcMs(iso: string): number {
  const match = ISO_DATE.exec(iso);
  if (match === null) throw new RangeError(`not an ISO date: ${iso}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function utcMsToIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return utcMsToIso(isoToUtcMs(iso) + days * DAY_MS);
}

/** Days from `start` to `end`, both included (0 if `end` is before `start`). */
export function dayCount(start: string, end: string): number {
  return Math.max(0, Math.round((isoToUtcMs(end) - isoToUtcMs(start)) / DAY_MS) + 1);
}

/** Every date from `start` to `end`, both included. */
export function dateRange(start: string, end: string): string[] {
  const first = isoToUtcMs(start);
  return Array.from({ length: dayCount(start, end) }, (_, k) => utcMsToIso(first + k * DAY_MS));
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "20060101" → "2006-01-01". */
export function isoFromCompact(compact: string): string {
  if (!/^\d{8}$/.test(compact)) throw new RangeError(`not a YYYYMMDD date: ${compact}`);
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

/** "2006-01-01" → "20060101". */
export function compactFromIso(iso: string): string {
  isoToUtcMs(iso);
  return iso.replaceAll("-", "");
}

export function todayIso(): string {
  return utcMsToIso(Date.now());
}
