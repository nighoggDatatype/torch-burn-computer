import { G, DAY } from './constants.js';

type GameDate =  {y:number,mo:number,d:number}
export type GameDateTime = {date:GameDate|null, seconds:number}

/**
 * Strict numeric parser. Strips thousands-separator commas; rejects non-numeric
 * trailing characters that parseFloat would swallow (e.g. "12abc" → NaN).
 */
export function parseNum(str: string) : number {
  if (typeof str !== 'string') return NaN;
  const s = str.trim().replace(/,/g, '');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  return parseFloat(s);
}

/**
 * Acceleration parser. Accepts bare numbers ("1.95") or g-suffixed ("1.95g" / "1.95G").
 * Strips all trailing g/G characters before parsing so "1.95ggg" is handled gracefully.
 * @param {string} str
 * @returns {number} Value in m/s², or NaN on bad input.
 */
export function parseGValue(str: string) {
  if (!str || typeof str !== 'string') return NaN;
  const s = str.trim().replace(/,/g, '').replace(/g+$/i, '');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  return parseFloat(s) * G;
}

/**
 * Parses a game clock string. Accepts full datetime "YYYY-MM-DD HH:MM:SS"
 * or strict time-only "HH:MM:SS". Bare "HH:MM" is intentionally rejected.
 */
export function parseGameTime(timeStr: string) : GameDateTime | null {
  if (!timeStr || !timeStr.trim()) return null;
  const str = timeStr.trim();
  // Try full datetime: YYYY-MM-DD HH:MM:SS
  const dtMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (dtMatch) {
    const [, y, mo, d, h, mi, s] = dtMatch.map(Number);
    const secs = h * 3600 + mi * 60 + s;
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(mo, y)) return null;
    if (mi > 59 || s > 59 || secs >= DAY) return null;
    return { date: { y, mo, d }, seconds: secs };
  }
  // Try time-only: HH:MM:SS (exactly, no partial segments)
  const timeMatch = str.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!timeMatch) return null;
  const [, h, mi, s] = timeMatch.map(Number);
  const secs = h * 3600 + mi * 60 + s;
  if (mi > 59 || s > 59 || secs >= DAY) return null;
  return { date: null, seconds: secs };
}

/** @param {number} mo @param {number} y @returns {number} */
export function daysInMonth(mo: number, y: number) {
  return new Date(y, mo, 0).getDate();
}

/**
 * Parses a mission duration string into seconds.
 * Accepts: "4d 3h 2m 37s", "4d 6:30:00", "HH:MM:SS", "H:MM:SS", "4d", "3h 30m", etc.
 * 1 day = DAY seconds (87,659 s — Ostranauts game day).
 * @param {string} str
 * @returns {number|null} Total seconds, or null on bad input.
 */
export function parseTargetDuration(str: string) {
  if (!str || !str.trim()) return null;
  const s = str.trim().toLowerCase();

  let total = 0;
  let matched = false;

  // Extract day component if present: e.g. "4d" (decimals allowed, e.g. "3.5d")
  const dayMatch = s.match(/([\d.]+)\s*d/);
  if (dayMatch) {
    total += parseFloat(dayMatch[1]) * DAY;
    matched = true;
  }

  // Extract h/m/s components if present: "3h", "2m", "37s" (decimals allowed, e.g. "39.09h")
  const hourMatch = s.match(/([\d.]+)\s*h/);
  const minMatch = s.match(/([\d.]+)\s*m(?!s)/); // 'm' not followed by 's' (avoid 'ms')
  const secMatch = s.match(/([\d.]+)\s*s/);
  if (hourMatch) {
    total += parseFloat(hourMatch[1]) * 3600;
    matched = true;
  }
  if (minMatch) {
    total += parseFloat(minMatch[1]) * 60;
    matched = true;
  }
  if (secMatch) {
    total += parseFloat(secMatch[1]);
    matched = true;
  }

  // Reject trailing/embedded garbage that the d/h/m/s patterns didn't consume,
  // e.g. "5h555555" would otherwise silently parse as just "5h".
  if (matched) {
    let remainder = s;
    if (dayMatch) remainder = remainder.replace(dayMatch[0], '');
    if (hourMatch) remainder = remainder.replace(hourMatch[0], '');
    if (minMatch) remainder = remainder.replace(minMatch[0], '');
    if (secMatch) remainder = remainder.replace(secMatch[0], '');
    if (remainder.trim() !== '') return null;
  }

  // If no d/h/m/s tokens found, try plain HH:MM:SS or HH:MM
  if (!matched) {
    const parts = s.split(':').map((p: string) => p.trim());
    if (parts.length >= 2 && parts.length <= 3) {
      const nums = parts.map(Number);
      if (
        nums.every((n: number) => isFinite(n) && n >= 0) &&
        nums[1] <= 59 &&
        (nums[2] === undefined || nums[2] <= 59)
      ) {
        total = nums[0] * 3600 + nums[1] * 60 + (nums[2] || 0);
        matched = true;
      }
    }
  }

  // Last resort: bare positive integer — treat as seconds
  if (!matched && /^\d+$/.test(s)) {
    const bare = parseInt(s, 10);
    if (bare > 0) {
      total = bare;
      matched = true;
    }
  }

  if (!matched || total <= 0) return null;
  return Math.round(total * 1000) / 1000;
}