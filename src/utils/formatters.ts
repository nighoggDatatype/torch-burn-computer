import { DAY } from './constants.js';
import { daysInMonth } from './parsers.js';

export type FinalGameTime = {
    dateStr: string | null;
    timeStr: string;
    hasDate: boolean;
    dayOffset: number;
}

/**
 * TODO: Double check that this actually does what it says
 * @param {number} seconds
 * @returns {string} e.g. "1:23:45" or "3:07"
 */
export function formatTime(seconds: number) {
  if (!isFinite(seconds) || seconds < 0) return '—';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Formats velocity to the appropriate unit number, either m or km
 */
export function formatDistance(meters: number) {
  if (!isFinite(meters)) return '—';
  if (Math.abs(meters) >= 1000) {
    return `${(meters / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} km`;
  }
  return `${meters.toFixed(0)} m`;
}

/**
 * Formats velocity to the appropriate unit number, either m/s or km/s
 */
export function formatVelocity(mps: number) {
  if (!isFinite(mps)) return '—';
  if (Math.abs(mps) >= 1000) return `${(mps / 1000).toFixed(2)} km/s`;
  return `${mps.toFixed(1)} m/s`;
}

/**
 * Adds an offset to a parsed game-time base, rolling over day/month/year boundaries.
 */
export function addGameTime(base: { date: { y: number; mo: number; d: number; }; seconds: number; } | { date: null; seconds: number; } | null, offsetSeconds: number) : FinalGameTime | null {
  if (base == null || !isFinite(offsetSeconds)) return null;
  let total = base.seconds + Math.floor(offsetSeconds);
  const datePart = base.date ? { ...base.date } : null;
  // Day rollover always runs, even with no calendar date, so time-only inputs
  // wrap at the DAY boundary instead of accumulating past 24h indefinitely.
  let dayOffset = 0;
  while (total >= DAY) {
    total -= DAY;
    dayOffset += 1;
    if (datePart) {
      datePart.d += 1;
      const dim = daysInMonth(datePart.mo, datePart.y);
      if (datePart.d > dim) {
        datePart.d = 1;
        datePart.mo += 1;
      }
      if (datePart.mo > 12) {
        datePart.mo = 1;
        datePart.y += 1;
      }
    }
  }
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  const dateStr = datePart
    ? `${datePart.y}-${String(datePart.mo).padStart(2, '0')}-${String(datePart.d).padStart(2, '0')}`
    : null;
  return { dateStr, timeStr, hasDate: !!datePart, dayOffset };
}

/**
 */
export function formatGameTime(parsed: { dateStr: string | null; timeStr: string; hasDate: boolean; dayOffset: number; } | null) {
  if (!parsed) return null;
  if (parsed.hasDate) return `${parsed.dateStr} ${parsed.timeStr}`;
  if (parsed.dayOffset > 0) return `T+${parsed.dayOffset}D ${parsed.timeStr}`;
  return parsed.timeStr;
}

/**
 * Formats a duration in seconds as a compact human-readable string,
 * suppressing all leading and trailing zero components.
 * e.g. 90 → "1M 30S", 3600 → "1H", 3661 → "1H 1M 1S", 90000 → "1D 40M"
 * @param {number} seconds
 * @returns {string|null}
 */
export function formatTargetDuration(seconds: number) {
  if (!isFinite(seconds) || seconds <= 0) return null;
  const total = Math.floor(seconds);
  const days = Math.floor(total / DAY);
  const rem = total % DAY;
  const h = Math.floor(rem / 3600);
  const m = Math.floor((rem % 3600) / 60);
  const sc = rem % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}D`);
  if (h > 0) parts.push(`${h}H`);
  if (m > 0) parts.push(`${m}M`);
  if (sc > 0) parts.push(`${sc}S`);
  return parts.length > 0 ? parts.join(' ') : '0S';
}