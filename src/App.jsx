import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, Clock } from 'lucide-react';

const APP_VERSION = 'v0.4.0';

const G = 9.80665; // standard gravity, m/s²
const AU = 149_597_870_700; // meters per astronomical unit
// Game day: standard 24h clock + "untime" (24:00:00 → 24:20:58),
// then rolls to 00:00:00. Last displayed second 24:20:58 = 87,658 s.
const DAY = 24 * 3600 + 20 * 60 + 59; // 87,659 s — rollover point

// ───── helpers ─────────────────────────────────────────────────────────

// Strict numeric parser: strips thousands-separator commas, rejects any
// non-numeric trailing characters that parseFloat would silently swallow
// (e.g. "12abc" → NaN, "1,200" → 1200, "1.2.3" → NaN).
function parseNum(str) {
  if (typeof str !== 'string') return NaN;
  const s = str.trim().replace(/,/g, '');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  return parseFloat(s);
}
function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '—';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDistance(meters) {
  if (!isFinite(meters)) return '—';
  if (Math.abs(meters) >= 1000) {
    return `${(meters / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} km`;
  }
  return `${meters.toFixed(0)} m`;
}

function formatVelocity(mps) {
  if (!isFinite(mps)) return '—';
  if (Math.abs(mps) >= 1000) return `${(mps / 1000).toFixed(2)} km/s`;
  return `${mps.toFixed(1)} m/s`;
}

function parseGameTime(timeStr) {
  if (!timeStr || !timeStr.trim()) return null;
  const str = timeStr.trim();
  // Try full datetime: YYYY-MM-DD HH:MM:SS
  const dtMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (dtMatch) {
    const [, y, mo, d, h, mi, s] = dtMatch.map(Number);
    const secs = h * 3600 + mi * 60 + s;
    if (mi > 59 || s > 59 || secs >= DAY) return null;
    return { date: { y, mo, d }, seconds: secs };
  }
  // Try time-only: HH:MM:SS or HH:MM
  const parts = str.split(':').map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !isFinite(n) || n < 0)) return null;
  const [h, mi, s = 0] = nums;
  const secs = h * 3600 + mi * 60 + s;
  if (mi > 59 || s > 59 || secs >= DAY) return null;
  return { date: null, seconds: secs };
}

function daysInMonth(mo, y) {
  return new Date(y, mo, 0).getDate();
}

function addGameTime(base, offsetSeconds) {
  if (base == null || !isFinite(offsetSeconds)) return null;
  let total = base.seconds + Math.floor(offsetSeconds);
  let datePart = base.date ? { ...base.date } : null;
  if (datePart) {
    while (total >= DAY) {
      total -= DAY;
      datePart.d += 1;
      const dim = daysInMonth(datePart.mo, datePart.y);
      if (datePart.d > dim) { datePart.d = 1; datePart.mo += 1; }
      if (datePart.mo > 12) { datePart.mo = 1; datePart.y += 1; }
    }
  }
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  const dateStr = datePart
    ? `${datePart.y}-${String(datePart.mo).padStart(2, '0')}-${String(datePart.d).padStart(2, '0')}`
    : null;
  return { dateStr, timeStr, hasDate: !!datePart };
}

function formatGameTime(parsed) {
  if (!parsed) return null;
  return parsed.hasDate ? `${parsed.dateStr} ${parsed.timeStr}` : parsed.timeStr;
}


function computePlan({ distance_m, v0_mps, a_mps2, v_arrival_mps, t_rotate_s }) {
  if (![distance_m, v0_mps, a_mps2, v_arrival_mps, t_rotate_s].every(isFinite)) {
    return { error: 'MISSING OR INVALID INPUT', detail: 'One or more fields are empty or non-numeric.' };
  }
  if (a_mps2 <= 0) return { error: 'ACCELERATION MUST BE POSITIVE', detail: 'Enter a thrust value greater than zero.' };
  if (distance_m <= 0) return { error: 'BURN DISTANCE IS ZERO OR NEGATIVE', detail: 'Increase the total distance.' };

  if (v_arrival_mps < 0) return { error: 'CUTOFF VELOCITY CANNOT BE NEGATIVE', detail: 'Enter the desired speed at torch cutoff.' };
  if (t_rotate_s < 0) return { error: 'FLIP TIME CANNOT BE NEGATIVE', detail: 'Enter zero or a positive flip duration.' };

  const brake_only_dist =
    v0_mps * t_rotate_s + (v0_mps * v0_mps - v_arrival_mps * v_arrival_mps) / (2 * a_mps2);

  if (brake_only_dist > distance_m + 1e-6) {
    return {
      overshoot: true,
      brake_only_dist,
      shortfall: brake_only_dist - distance_m,
      t_brake_full: t_rotate_s + (v0_mps - v_arrival_mps) / a_mps2,
    };
  }

  const B = a_mps2 * t_rotate_s;
  const C = v0_mps * v0_mps + v_arrival_mps * v_arrival_mps + 2 * a_mps2 * distance_m;
  const v_max = (-B + Math.sqrt(B * B + 2 * C)) / 2;

  if (v_max <= v0_mps + 1e-6) {
    const t_brake = (v0_mps - v_arrival_mps) / a_mps2;
    return {
      flip_now: true,
      v_max: v0_mps,
      t_accel: 0,
      t_rotate: t_rotate_s,
      t_brake,
      t_total: t_rotate_s + t_brake,
      d_accel: 0,
      d_coast: v0_mps * t_rotate_s,
      d_brake: (v0_mps * v0_mps - v_arrival_mps * v_arrival_mps) / (2 * a_mps2),
    };
  }

  const t_accel = (v_max - v0_mps) / a_mps2;
  const t_brake = (v_max - v_arrival_mps) / a_mps2;
  return {
    v_max,
    t_accel,
    t_rotate: t_rotate_s,
    t_brake,
    t_total: t_accel + t_rotate_s + t_brake,
    d_accel: (v_max * v_max - v0_mps * v0_mps) / (2 * a_mps2),
    d_coast: v_max * t_rotate_s,
    d_brake: (v_max * v_max - v_arrival_mps * v_arrival_mps) / (2 * a_mps2),
  };
}

function computeFinalApproach({ distance_m, v0_mps, a_mps2, v_arrival_mps }) {
  if (![distance_m, v0_mps, a_mps2, v_arrival_mps].every(isFinite)) {
    return { error: 'MISSING OR INVALID INPUT', detail: 'One or more fields are empty or non-numeric.' };
  }
  if (a_mps2 <= 0) return { error: 'ACCELERATION MUST BE POSITIVE', detail: 'Enter a thrust value greater than zero.' };
  if (v0_mps <= 0) return { error: 'CLOSING VELOCITY MUST BE POSITIVE', detail: 'Enter a positive closing speed.' };
  if (distance_m <= 0) return { error: 'RANGE IS ZERO OR NEGATIVE', detail: 'Increase the distance to target.' };
  if (v_arrival_mps < 0) return { error: 'CUTOFF VELOCITY CANNOT BE NEGATIVE', detail: 'Enter the desired speed at torch cutoff.' };
  if (v_arrival_mps >= v0_mps) return { error: 'CUTOFF VELOCITY MUST BE LESS THAN CURRENT VREL', detail: 'You must be braking toward a lower speed.' };

  // Distance needed to brake from v0 to v_arrival at max G
  const d_brake_max = (v0_mps * v0_mps - v_arrival_mps * v_arrival_mps) / (2 * a_mps2);
  const t_brake_max = (v0_mps - v_arrival_mps) / a_mps2;

  // Required deceleration to stop in the available distance
  const required_a = (v0_mps * v0_mps - v_arrival_mps * v_arrival_mps) / (2 * distance_m);

  if (d_brake_max > distance_m + 1e-6) {
    // Can't stop in time even at max G
    return {
      overshoot: true,
      d_brake_needed: d_brake_max,
      shortfall: d_brake_max - distance_m,
      required_a,
      t_brake_if_max: t_brake_max,
    };
  }

  // Time to brake to arrival speed at max G
  const t_brake = t_brake_max;
  // Distance coasting (not yet braking) — player needs to wait this long before lighting torch
  const d_coast = distance_m - d_brake_max;
  const t_coast = d_coast / v0_mps; // time drifting at current speed before brake point

  return {
    t_brake,
    t_coast,
    d_brake: d_brake_max,
    d_coast,
    required_a,
    t_total: t_coast + t_brake,
  };
}

// ───── styles ──────────────────────────────────────────────────────────

const stylesheet = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&family=VT323&display=swap');

.bc-root {
  /* Ostranauts navigation-console palette */
  --bg-primary: #1a1d20;              /* dark gray frame body around panels */
  --bg-secondary: #54606c;            /* slate-blue panel face (base) */
  --bg-panel-top: #5d6975;            /* panel gradient top highlight */
  --bg-panel-bottom: #4a5460;         /* panel gradient bottom shadow */
  --bg-tertiary: #3a444e;             /* darker recessed surface (for Stage 3 LCDs) */
  --bg-input: #1a1d22;                /* near-black input/LCD background */
  --border: #2a2f36;                  /* dark outer panel border */
  --border-strong: #3d4854;
  --border-highlight: rgba(255, 255, 255, 0.05); /* subtle top-edge metal sheen */
  --text-primary: #e8ecf0;            /* primary label/text - bright */
  --text-secondary: #c0c8d2;          /* clearly visible labels */
  --text-dim: #8a929a;                /* subdued but readable on slate */
  --amber: #ffb547;
  --amber-dim: #d99a3e;
  --amber-deep: #6b4715;
  --cyan: #4dd0ff;
  --green: #4ade80;
  --yellow: #facc15;
  --red: #ff5d5d;

  font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  background: var(--bg-primary);
  color: var(--text-primary);
  min-height: 100vh;
  padding: 24px;
  letter-spacing: 0.02em;
  position: relative;
}

.bc-root::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    to bottom,
    transparent 0px,
    transparent 2px,
    rgba(0, 0, 0, 0.07) 2px,
    rgba(0, 0, 0, 0.07) 3px
  );
  z-index: 9999;
}

.bc-container { max-width: 1100px; margin: 0 auto; }

.bc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 1px solid var(--border);
  border-left: 3px solid var(--amber);
  background:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.07'/%3E%3C/svg%3E"),
    radial-gradient(circle at 12px 12px, rgba(200,215,225,0.25) 2px, transparent 3px),
    radial-gradient(circle at calc(100% - 12px) 12px, rgba(200,215,225,0.25) 2px, transparent 3px),
    radial-gradient(circle at 12px calc(100% - 12px), rgba(200,215,225,0.25) 2px, transparent 3px),
    radial-gradient(circle at calc(100% - 12px) calc(100% - 12px), rgba(200,215,225,0.25) 2px, transparent 3px),
    radial-gradient(circle at 14px 14px, #4a5460 5px, #111518 6px, transparent 7px),
    radial-gradient(circle at calc(100% - 14px) 14px, #4a5460 5px, #111518 6px, transparent 7px),
    radial-gradient(circle at 14px calc(100% - 14px), #4a5460 5px, #111518 6px, transparent 7px),
    radial-gradient(circle at calc(100% - 14px) calc(100% - 14px), #4a5460 5px, #111518 6px, transparent 7px),
    linear-gradient(165deg, var(--bg-panel-top) 0%, var(--bg-panel-bottom) 60%, #2e3840 100%);
  box-shadow:
    inset 0 1px 0 var(--border-highlight),
    inset 0 -2px 0 rgba(0, 0, 0, 0.35),
    inset 3px 0 10px rgba(0, 0, 0, 0.2),
    inset -3px 0 10px rgba(0, 0, 0, 0.15),
    inset 0 4px 16px rgba(0, 0, 0, 0.12),
    0 3px 8px rgba(0, 0, 0, 0.6);
  padding: 14px 20px;
  margin-bottom: 16px;
}

.bc-brand {
  font-family: 'IBM Plex Mono', monospace;
  font-weight: 500;
  font-size: 10px;
  letter-spacing: 0.25em;
  color: var(--amber-dim);
  text-transform: uppercase;
  margin-bottom: 4px;
}

.bc-title {
  font-family: 'IBM Plex Mono', monospace;
  font-weight: 700;
  font-size: 16px;
  letter-spacing: 0.2em;
  color: var(--amber);
  text-transform: uppercase;
}

.bc-status-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-right: 8px;
}
.bc-status-light {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}
.bc-status-light.ready {
  background: #4ade80;
  box-shadow: 0 0 8px #4ade80;
  animation: none;
}
.bc-status-light.invalid {
  background: #ff5d5d;
  box-shadow: 0 0 6px #ff5d5d;
  animation: none;
}
.bc-status-light.overshoot {
  background: #ff5d5d;
  box-shadow: 0 0 8px #ff5d5d;
  animation: none;
}
.bc-status-light.clock {
  background: #4dd0ff;
  box-shadow: 0 0 6px #4dd0ff;
  animation: none;
  width: 7px;
  height: 7px;
}
@keyframes bc-pulse-slow {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
@keyframes bc-pulse-fast {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.15; }
}
@keyframes bc-blink-hard {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0.2; }
}

.bc-status-text {
  font-size: 11px;
  color: var(--text-secondary);
  letter-spacing: 0.15em;
  text-transform: uppercase;
}

.bc-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}
@media (max-width: 768px) {
  .bc-grid { grid-template-columns: 1fr; }
}

.bc-panel {
  background:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.07'/%3E%3C/svg%3E"),
    radial-gradient(circle at 12px 12px, rgba(200,215,225,0.25) 2px, transparent 3px),
    radial-gradient(circle at calc(100% - 12px) 12px, rgba(200,215,225,0.25) 2px, transparent 3px),
    radial-gradient(circle at 12px calc(100% - 12px), rgba(200,215,225,0.25) 2px, transparent 3px),
    radial-gradient(circle at calc(100% - 12px) calc(100% - 12px), rgba(200,215,225,0.25) 2px, transparent 3px),
    radial-gradient(circle at 14px 14px, #4a5460 5px, #111518 6px, transparent 7px),
    radial-gradient(circle at calc(100% - 14px) 14px, #4a5460 5px, #111518 6px, transparent 7px),
    radial-gradient(circle at 14px calc(100% - 14px), #4a5460 5px, #111518 6px, transparent 7px),
    radial-gradient(circle at calc(100% - 14px) calc(100% - 14px), #4a5460 5px, #111518 6px, transparent 7px),
    linear-gradient(165deg, var(--bg-panel-top) 0%, var(--bg-panel-bottom) 60%, #2e3840 100%);
  box-shadow:
    inset 0 1px 0 var(--border-highlight),
    inset 0 -2px 0 rgba(0, 0, 0, 0.35),
    inset 3px 0 10px rgba(0, 0, 0, 0.2),
    inset -3px 0 10px rgba(0, 0, 0, 0.15),
    inset 0 4px 16px rgba(0, 0, 0, 0.12),
    0 3px 8px rgba(0, 0, 0, 0.6);
  padding: 16px 20px;
}

.bc-panel-header {
  font-size: 11px;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border);
  padding-bottom: 8px;
  margin-bottom: 14px;
  text-align: center;
}

.bc-input-row {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
  gap: 8px;
}
.bc-input-row:last-child { margin-bottom: 0; }

.bc-label {
  font-size: 10px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--text-secondary);
  width: 110px;
  flex-shrink: 0;
}

.bc-input {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-top-color: #0a0c0f;
  border-left-color: #0a0c0f;
  color: var(--amber);
  padding: 8px 10px;
  font-family: 'VT323', monospace;
  font-size: 18px;
  flex: 1;
  min-width: 0;
  outline: none;
  transition: border-color 0.15s;
  box-shadow:
    inset 0 2px 5px rgba(0, 0, 0, 0.6),
    inset 0 0 12px rgba(0, 0, 0, 0.3);
  text-shadow: 0 0 6px rgba(255, 181, 71, 0.4);
}
.bc-input:focus { border-color: var(--amber-dim); box-shadow: inset 0 2px 5px rgba(0,0,0,0.6), inset 0 0 12px rgba(0,0,0,0.3), 0 0 0 1px var(--amber-deep); }
.bc-input::placeholder {
  color: var(--text-dim);
  font-size: 13px;
  font-family: 'IBM Plex Mono', monospace;
  letter-spacing: 0.04em;
  opacity: 1;
}
.bc-input.invalid { border-color: var(--red); color: var(--red); text-shadow: 0 0 6px rgba(255, 93, 93, 0.4); }
.bc-input:disabled {
  color: var(--text-dim);
  opacity: 0.55;
  cursor: not-allowed;
  text-shadow: none;
}

/* Field-level caption notes below inputs */
.bc-field-note {
  font-size: 10px;
  color: var(--text-secondary);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.bc-field-note--indent {
  padding-left: 118px;
}

.bc-unit-toggle {
  display: flex;
  border: 1px solid var(--border);
  background: #0e1115;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.5);
  gap: 2px;
  padding: 2px;
}
.bc-unit-btn {
  background: #1e262f;
  border: 1px solid #0a0c0f;
  border-bottom-color: #2a333c;
  border-right-color: #2a333c;
  color: var(--text-dim);
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  padding: 5px 8px;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  transition: all 0.1s;
}
.bc-unit-btn:hover { color: var(--text-secondary); background: #252f39; }
.bc-unit-btn.active {
  background: var(--amber-deep);
  border-color: #4a2e0a;
  border-top-color: #7a4a12;
  border-left-color: #7a4a12;
  color: var(--amber);
  box-shadow: inset 0 1px 3px rgba(0,0,0,0.4);
  text-shadow: 0 0 6px rgba(255, 181, 71, 0.5);
}

.bc-readout {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 0;
  border-bottom: 1px solid rgba(0,0,0,0.2);
  gap: 8px;
}
.bc-readout:last-child { border-bottom: none; }

.bc-readout-label {
  font-size: 10px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.bc-readout-value {
  font-family: 'VT323', monospace;
  font-size: 22px;
  color: var(--amber);
  letter-spacing: 0.04em;
  background: var(--bg-input);
  padding: 2px 10px 0;
  border: 1px solid var(--border);
  border-top-color: #0a0c0f;
  border-left-color: #0a0c0f;
  box-shadow:
    inset 0 2px 4px rgba(0, 0, 0, 0.5),
    inset 0 0 8px rgba(0, 0, 0, 0.2);
  text-shadow: 0 0 8px rgba(255, 181, 71, 0.35);
  min-width: 120px;
  text-align: right;
}
.bc-readout-value.highlight {
  color: var(--cyan);
  font-size: 26px;
  text-shadow: 0 0 10px rgba(77, 208, 255, 0.4);
}
.bc-readout-value.dim {
  color: var(--text-dim);
  font-size: 18px;
  text-shadow: none;
}

.bc-warning {
  border-left: 3px solid var(--red);
  background: rgba(255, 93, 93, 0.05);
  padding: 12px 16px;
  margin-bottom: 12px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.bc-warning-text {
  font-size: 12px;
  color: var(--red);
  letter-spacing: 0.05em;
  line-height: 1.5;
}
.bc-warning-text strong { color: var(--red); font-weight: 700; }

.bc-info {
  border-left: 3px solid var(--cyan);
  background: rgba(77, 208, 255, 0.05);
  padding: 12px 16px;
  margin-bottom: 12px;
  font-size: 11px;
  color: var(--cyan);
  letter-spacing: 0.05em;
}

.bc-mode-toggle {
  display: flex;
  gap: 0;
  margin-bottom: 18px;
  border: 1px solid var(--border-strong);
  border-radius: 2px;
  overflow: hidden;
}
.bc-mode-btn {
  flex: 1;
  background: #1e262f;
  border: none;
  border-right: 1px solid var(--border-strong);
  color: var(--text-dim);
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  font-weight: 500;
  padding: 8px 12px;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  transition: all 0.1s;
}
.bc-mode-btn:last-child { border-right: none; }
.bc-mode-btn:hover { color: var(--text-secondary); background: #252f39; }
.bc-mode-btn.active {
  background: rgba(255, 181, 71, 0.12);
  color: var(--amber);
  border-bottom: 2px solid var(--amber);
}

.bc-fa-notice {
  border-left: 3px solid var(--cyan);
  background: rgba(77, 208, 255, 0.06);
  padding: 10px 14px;
  margin-bottom: 12px;
  font-size: 10px;
  color: var(--cyan);
  letter-spacing: 0.08em;
  line-height: 1.6;
}

.bc-fa-ok {
  border-left: 3px solid var(--green);
  background: rgba(74, 222, 128, 0.06);
  padding: 10px 14px;
  margin-bottom: 8px;
  font-size: 10px;
  color: var(--green);
  letter-spacing: 0.08em;
}

.bc-fa-warn {
  border-left: 3px solid var(--red);
  background: rgba(255, 93, 93, 0.08);
  padding: 10px 14px;
  margin-bottom: 8px;
  font-size: 10px;
  color: var(--red);
  letter-spacing: 0.08em;
  line-height: 1.6;
}

.bc-advisory {
  border-left: 3px solid var(--amber);
  background: rgba(255, 181, 71, 0.06);
  padding: 12px 16px;
  margin-bottom: 12px;
  font-size: 11px;
  color: var(--amber);
  letter-spacing: 0.05em;
  line-height: 1.6;
}

.bc-timeline-panel { margin-bottom: 16px; }

/* ── per-panel scratch overlays (feature 9) ───────────── */
.bc-panel.scratch-a { --scratch: url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%27300%27%20height=%27300%27%3E%3Cfilter%20id=%27s7%27%3E%3CfeTurbulence%20type=%27turbulence%27%20baseFrequency=%270.7%200.015%27%20numOctaves=%273%27%20seed=%277%27%20stitchTiles=%27stitch%27/%3E%3CfeColorMatrix%20type=%27saturate%27%20values=%270%27/%3E%3CfeComponentTransfer%3E%3CfeFuncA%20type=%27linear%27%20slope=%270.2%27/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect%20width=%27300%27%20height=%27300%27%20filter=%27url(%23s7)%27/%3E%3C/svg%3E"); }
.bc-panel.scratch-b { --scratch: url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%27300%27%20height=%27300%27%3E%3Cfilter%20id=%27s23%27%3E%3CfeTurbulence%20type=%27turbulence%27%20baseFrequency=%270.6%200.012%27%20numOctaves=%273%27%20seed=%2723%27%20stitchTiles=%27stitch%27/%3E%3CfeColorMatrix%20type=%27saturate%27%20values=%270%27/%3E%3CfeComponentTransfer%3E%3CfeFuncA%20type=%27linear%27%20slope=%270.22%27/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect%20width=%27300%27%20height=%27300%27%20filter=%27url(%23s23)%27/%3E%3C/svg%3E"); }
.bc-panel.scratch-c { --scratch: url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%27300%27%20height=%27300%27%3E%3Cfilter%20id=%27s41%27%3E%3CfeTurbulence%20type=%27turbulence%27%20baseFrequency=%270.75%200.018%27%20numOctaves=%273%27%20seed=%2741%27%20stitchTiles=%27stitch%27/%3E%3CfeColorMatrix%20type=%27saturate%27%20values=%270%27/%3E%3CfeComponentTransfer%3E%3CfeFuncA%20type=%27linear%27%20slope=%270.18%27/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect%20width=%27300%27%20height=%27300%27%20filter=%27url(%23s41)%27/%3E%3C/svg%3E"); }
.bc-header.scratch-d { --scratch: url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%27300%27%20height=%27300%27%3E%3Cfilter%20id=%27s13%27%3E%3CfeTurbulence%20type=%27turbulence%27%20baseFrequency=%270.65%200.014%27%20numOctaves=%273%27%20seed=%2713%27%20stitchTiles=%27stitch%27/%3E%3CfeColorMatrix%20type=%27saturate%27%20values=%270%27/%3E%3CfeComponentTransfer%3E%3CfeFuncA%20type=%27linear%27%20slope=%270.19%27/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect%20width=%27300%27%20height=%27300%27%20filter=%27url(%23s13)%27/%3E%3C/svg%3E"); }

.bc-panel.scratch-a,
.bc-panel.scratch-b,
.bc-panel.scratch-c {
  background-image:
    var(--scratch),
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.07'/%3E%3C/svg%3E"),
    radial-gradient(circle at 12px 12px, rgba(200,215,225,0.25) 2px, transparent 3px),
    radial-gradient(circle at calc(100% - 12px) 12px, rgba(200,215,225,0.25) 2px, transparent 3px),
    radial-gradient(circle at 12px calc(100% - 12px), rgba(200,215,225,0.25) 2px, transparent 3px),
    radial-gradient(circle at calc(100% - 12px) calc(100% - 12px), rgba(200,215,225,0.25) 2px, transparent 3px),
    radial-gradient(circle at 14px 14px, #4a5460 5px, #111518 6px, transparent 7px),
    radial-gradient(circle at calc(100% - 14px) 14px, #4a5460 5px, #111518 6px, transparent 7px),
    radial-gradient(circle at 14px calc(100% - 14px), #4a5460 5px, #111518 6px, transparent 7px),
    radial-gradient(circle at calc(100% - 14px) calc(100% - 14px), #4a5460 5px, #111518 6px, transparent 7px),
    linear-gradient(165deg, #495460 0%, #3a4450 60%, #2e3840 100%);
  background-repeat: repeat, repeat, no-repeat, no-repeat, no-repeat, no-repeat, no-repeat, no-repeat, no-repeat, no-repeat, no-repeat;
  background-size: 300px 300px, 200px 200px, auto, auto, auto, auto, auto, auto, auto, auto, 100% 100%;
}



.bc-timeline {
  position: relative;
  height: 64px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  margin: 8px 0 30px;
}

.bc-timeline-phase {
  position: absolute;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  transition: width 0.3s ease, left 0.3s ease;
  overflow: hidden;
}
.bc-timeline-phase.accel {
  background: linear-gradient(90deg, rgba(74, 222, 128, 0.1), rgba(74, 222, 128, 0.25));
  color: var(--green);
}
.bc-timeline-phase.rotate {
  background: repeating-linear-gradient(
    45deg,
    rgba(250, 204, 21, 0.15),
    rgba(250, 204, 21, 0.15) 6px,
    rgba(250, 204, 21, 0.25) 6px,
    rgba(250, 204, 21, 0.25) 12px
  );
  color: var(--yellow);
  border-left: 2px solid var(--yellow);
  border-right: 2px solid var(--yellow);
}
.bc-timeline-phase.brake {
  background: linear-gradient(90deg, rgba(255, 93, 93, 0.25), rgba(255, 93, 93, 0.1));
  color: var(--red);
}
.bc-timeline-phase.drift {
  background: linear-gradient(90deg, rgba(138, 153, 173, 0.12), rgba(138, 153, 173, 0.08));
  color: var(--text-dim);
  border-left: 1px dashed var(--text-dim);
  border-right: 1px dashed var(--text-dim);
}
.bc-timeline-tick {
  position: absolute;
  top: 100%;
  font-size: 8px;
  color: var(--text-dim);
  letter-spacing: 0.1em;
  margin-top: 4px;
  transform: translateX(-50%);
  white-space: nowrap;
  text-transform: uppercase;
}
.bc-timeline-tick.key { color: var(--amber); }

.bc-targets-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 16px;
}
@media (max-width: 720px) {
  .bc-targets-grid { grid-template-columns: 1fr; }
}

.bc-target-cell {
  background:
    radial-gradient(circle at 8px 8px, rgba(200,215,225,0.15) 1.5px, transparent 2px),
    radial-gradient(circle at calc(100% - 8px) 8px, rgba(200,215,225,0.15) 1.5px, transparent 2px),
    radial-gradient(circle at 8px calc(100% - 8px), rgba(200,215,225,0.15) 1.5px, transparent 2px),
    radial-gradient(circle at calc(100% - 8px) calc(100% - 8px), rgba(200,215,225,0.15) 1.5px, transparent 2px),
    linear-gradient(165deg, #495460 0%, #3a4450 60%, #2e3840 100%);
  border: 1px solid var(--border);
  box-shadow:
    inset 0 1px 0 var(--border-highlight),
    inset 0 -2px 0 rgba(0,0,0,0.3),
    0 2px 6px rgba(0,0,0,0.4);
  padding: 12px 12px;
  text-align: center;
  position: relative;
}
.bc-target-cell.rotate { border-top: 2px solid var(--yellow); }
.bc-target-cell.brake { border-top: 2px solid var(--red); }
.bc-target-cell.arrive { border-top: 2px solid var(--cyan); }

.bc-target-label {
  font-size: 9px;
  color: var(--text-dim);
  letter-spacing: 0.2em;
  text-transform: uppercase;
  margin-bottom: 8px;
}
.bc-target-date {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  color: var(--text-dim);
  letter-spacing: 0.15em;
  text-transform: uppercase;
  margin-bottom: 2px;
}

.bc-target-time {
  font-family: 'VT323', monospace;
  font-size: 36px;
  color: var(--amber);
  letter-spacing: 0.04em;
  line-height: 1.1;
  background: var(--bg-input);
  display: block;
  padding: 4px 12px 0;
  margin: 0 auto;
  border: 1px solid var(--border);
  border-top-color: #0a0c0f;
  border-left-color: #0a0c0f;
  box-shadow:
    inset 0 2px 6px rgba(0, 0, 0, 0.6),
    inset 0 0 12px rgba(0, 0, 0, 0.25);
  text-shadow: 0 0 10px rgba(255, 181, 71, 0.4);
}
.bc-target-time.game-time {
  color: var(--cyan);
  text-shadow: 0 0 10px rgba(77, 208, 255, 0.45);
}
.bc-target-time.game-time.future-day {
  font-size: 28px;
}
.bc-target-relative {
  font-size: 10px;
  color: var(--text-dim);
  letter-spacing: 0.1em;
  margin-top: 6px;
  text-transform: uppercase;
}

/* ── boot sequence ─────────────────────────────────────── */
.bc-boot {
  position: fixed;
  inset: 0;
  background: #060809;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99999;
  transition: opacity 0.8s ease;
}
.bc-boot.fade-out { opacity: 0; pointer-events: none; }

.bc-boot-inner {
  width: 520px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 13px;
  letter-spacing: 0.1em;
  color: #ffb547;
  padding: 36px 40px;
  border: 1px solid #6b4715;
  background: #0a0c0e;
  box-shadow: 0 0 40px rgba(255, 181, 71, 0.08);
}
.bc-boot-line {
  line-height: 2.2;
  text-transform: uppercase;
  opacity: 0;
  transition: opacity 0.3s ease;
}
.bc-boot-line.visible { opacity: 1; }
.bc-boot-line.dim { color: #8a929a; font-size: 11px; }
.bc-boot-line.ok { color: #4ade80; }
.bc-boot-line.ready {
  color: #ffb547;
  font-size: 20px;
  font-family: 'VT323', monospace;
  margin-top: 10px;
  text-shadow: 0 0 12px rgba(255, 181, 71, 0.6);
}
.bc-boot-cursor {
  display: inline-block;
  width: 9px;
  height: 16px;
  background: #ffb547;
  margin-left: 4px;
  vertical-align: middle;
  animation: bc-blink 0.8s step-end infinite;
}
@keyframes bc-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

/* ── flicker animation (feature 11) ───────────────────── */
@keyframes bc-flicker {
  0%   { opacity: 1; }
  15%  { opacity: 0.25; }
  25%  { opacity: 1; }
  45%  { opacity: 0.35; }
  55%  { opacity: 1; }
  100% { opacity: 1; }
}
.bc-readout-value.flicker {
  animation: bc-flicker 0.18s ease-out;
}

/* ── tooltips ─────────────────────────────────────────── */
.bc-tooltip-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.bc-tooltip-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-strong);
  color: var(--text-dim);
  font-size: 9px;
  font-family: 'IBM Plex Mono', monospace;
  cursor: help;
  margin-left: 5px;
  flex-shrink: 0;
  transition: border-color 0.15s, color 0.15s;
  line-height: 1;
  user-select: none;
}
.bc-tooltip-badge:hover {
  border-color: var(--amber-dim);
  color: var(--amber);
}
.bc-tooltip-card {
  position: fixed;
  width: 280px;
  background: #0d1015;
  border: 1px solid var(--border-strong);
  box-shadow:
    0 4px 20px rgba(0,0,0,0.7),
    inset 0 1px 0 rgba(255,255,255,0.04);
  z-index: 10000;
  animation: bc-tooltip-in 0.12s ease-out;
  pointer-events: none;
  max-height: 80vh;
  overflow-y: auto;
}
@keyframes bc-tooltip-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.bc-tooltip-header {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 9px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--amber);
  padding: 8px 10px 6px;
  border-bottom: 1px solid var(--border);
}
.bc-tooltip-desc {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  color: var(--text-secondary);
  padding: 8px 10px;
  line-height: 1.6;
  letter-spacing: 0.03em;
  border-bottom: 1px solid var(--border);
}
.bc-tooltip-img {
  display: block;
  width: 100%;
  height: auto;
}

`;

// ───── component ───────────────────────────────────────────────────────

// Embedded screenshot data for tooltips
const TOOLTIP_IMG_DISTANCE   = `${import.meta.env.BASE_URL}tooltips/distance.jpg`;
const TOOLTIP_IMG_CURRENTVEL = `${import.meta.env.BASE_URL}tooltips/current-vel.jpg`;
const TOOLTIP_IMG_VCRS       = `${import.meta.env.BASE_URL}tooltips/vcrs.jpg`;


// ───── StandoffControl subcomponent ────────────────────────────────────────
// Renders the No-Wake toggle, stand-off distance input, and the field note.
// Shared between Burn Plan and Final Approach to avoid duplicating this block.

function NoWakeToggle({ noWakeEnabled, setNoWakeEnabled }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 118, marginBottom: 8 }}>
      <button
        className={`bc-unit-btn${noWakeEnabled ? ' active' : ''}`}
        onClick={() => setNoWakeEnabled(true)}
      >WAKE ZONE</button>
      <button
        className={`bc-unit-btn${!noWakeEnabled ? ' active' : ''}`}
        onClick={() => setNoWakeEnabled(false)}
        style={!noWakeEnabled ? { color: 'var(--cyan)', borderColor: 'var(--cyan)', background: 'rgba(77,208,255,0.12)' } : {}}
      >NO WAKE ZONE</button>
    </div>
  );
}

function StandoffControl({ noWakeEnabled, setNoWakeEnabled, standoffKm, setStandoffKm }) {
  return (
    <>
      <NoWakeToggle noWakeEnabled={noWakeEnabled} setNoWakeEnabled={setNoWakeEnabled} />
      {/* STAND-OFF DISTANCE — always visible; locked at 300 when zone ON */}
      <div className="bc-input-row">
        <div className="bc-label">Stand-off</div>
        <input
          className="bc-input"
          type="text"
          inputMode="decimal"
          value={noWakeEnabled ? '300' : standoffKm}
          placeholder="e.g. 2.5"
          disabled={noWakeEnabled}
          onChange={(e) => !noWakeEnabled && setStandoffKm(e.target.value)}
        />
        <div className="bc-unit-toggle">
          <button className="bc-unit-btn active">km</button>
        </div>
      </div>
      <div className="bc-field-note bc-field-note--indent" style={{ marginBottom: 4 }}>
        {noWakeEnabled
          ? <span>300 KM NO-WAKE ZONE SUBTRACTED FROM RANGE</span>
          : <span style={{ color: 'var(--cyan)' }}>{`◈ STAND-OFF: ${standoffKm || '?'} KM SUBTRACTED FROM RANGE`}</span>}
      </div>
    </>
  );
}

// ───── error boundary ──────────────────────────────────────────────────

class ErrorBoundary extends React.Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err) {
      return (
        <div style={{
          padding: 24,
          fontFamily: "'IBM Plex Mono', monospace",
          color: '#ff5d5d',
          letterSpacing: '0.1em',
          background: '#1a1d20',
          minHeight: '100vh',
        }}>
          ⚠ GUIDANCE COMPUTER FAULT<br /><br />
          {String(this.state.err?.message || this.state.err)}<br /><br />
          Reload to restart the nav subsystem.
        </div>
      );
    }
    return this.props.children;
  }
}

export default function BurnCalculator() {
  return <ErrorBoundary><BurnCalculatorInner /></ErrorBoundary>;
}

function BurnCalculatorInner() {
  // ── boot sequence state ──
  const [booting, setBooting] = useState(() => {
    try { return !sessionStorage.getItem('pa_booted'); } catch { return false; }
  });
  const [bootFade, setBootFade] = useState(false);
  const [visibleLines, setVisibleLines] = useState([]);

  useEffect(() => {
    if (!booting) return;
    try { sessionStorage.setItem('pa_booted', '1'); } catch { /* restricted context — skip */ }
    const timers = [];
    const lineDelays = [0, 300, 600, 1100, 1700, 2300, 2900, 3500, 4100, 5200];
    lineDelays.forEach((delay, i) => {
      timers.push(setTimeout(() => setVisibleLines(prev => [...prev, i]), delay));
    });
    timers.push(setTimeout(() => setBootFade(true), 7000));
    timers.push(setTimeout(() => setBooting(false), 8000));
    return () => timers.forEach(clearTimeout);
  }, []);

  const [appMode, setAppMode] = useState('burn'); // 'burn' | 'approach'

  // ── Final Approach state ──
  const [faDistance, setFaDistance] = useState('');
  const [faDistanceUnit, setFaDistanceUnit] = useState('km');
  const [faVrel, setFaVrel] = useState('');
  const [faVrelUnit, setFaVrelUnit] = useState('m/s');
  const [faAccel, setFaAccel] = useState('');
  const [faAccelUnit, setFaAccelUnit] = useState('g');
  const [faBudget, setFaBudget] = useState('');
  const [faBudgetUnit, setFaBudgetUnit] = useState('hr');
  const [faVArrival, setFaVArrival] = useState('0');
  const [faVArrivalUnit, setFaVArrivalUnit] = useState('m/s');
  const [faGameStart, setFaGameStart] = useState('');

  const [distance, setDistance] = useState('');
  const [distanceUnit, setDistanceUnit] = useState('km');
  const [v0, setV0] = useState('');
  const [v0Unit, setV0Unit] = useState('m/s');
  const [v0Direction, setV0Direction] = useState('closing');
  const [accel, setAccel] = useState('');
  const [accelUnit, setAccelUnit] = useState('g');
  const [flipTime, setFlipTime] = useState('60');
  const [reactantBudget, setReactantBudget] = useState('');
  const [reactantBudgetUnit, setReactantBudgetUnit] = useState('hr');
  const [burnPreference, setBurnPreference] = useState('speed'); // 'speed' | 'efficiency'
  const [vArrival, setVArrival] = useState('0');
  const [vArrivalUnit, setVArrivalUnit] = useState('m/s');
  const [vcrs, setVcrs] = useState('');
  const [vcrsUnit, setVcrsUnit] = useState('m/s');
  const [noWakeEnabled, setNoWakeEnabled] = useState(true); // toggle for 300 km no-wake zone
  const [standoffKm, setStandoffKm] = useState('2.5');     // adjustable stand-off when zone OFF

  const [gameStartTime, setGameStartTime] = useState('');

  // ── flicker state (feature 11) ──
  const [flickerKey, setFlickerKey] = useState(0);
  const prevPlanRef = useRef(null);

  // SI conversions
  const NO_WAKE_M = 300_000; // 300 km no-wake zone at destination
  const standoff_m = noWakeEnabled ? NO_WAKE_M : (parseNum(standoffKm) * 1000 || 0);
  const standoffValid = noWakeEnabled || (isFinite(parseNum(standoffKm)) && parseNum(standoffKm) > 0);
  const distance_m = parseNum(distance) * (distanceUnit === 'au' ? AU : distanceUnit === 'gm' ? 1e9 : distanceUnit === 'km' ? 1000 : 1);
  const raw_burn_distance_m = distance_m - standoff_m; // before VCRS correction
  const v0_mps = parseNum(v0) * (v0Unit === 'km/s' ? 1000 : 1) * (v0Direction === 'receding' ? -1 : 1);
  const a_mps2 = parseNum(accel) * (accelUnit === 'g' ? G : 1);
  const t_rotate_s = parseNum(flipTime);
  const v_arrival_mps = parseNum(vArrival) * (vArrivalUnit === 'km/s' ? 1000 : 1);
  const vcrs_mps = vcrs.trim() !== '' ? parseNum(vcrs) * (vcrsUnit === 'km/s' ? 1000 : 1) : 0;

  // Surface a clean error if the destination is within the stand-off zone
  const standoffError = !standoffValid
    ? 'invalid-standoff'
    : (isFinite(distance_m) && distance_m <= standoff_m)
      ? 'within-standoff'
      : null;
  const noWakeError = standoffError !== null; // keeps downstream compat

  // VCRS geometry correction (one-iteration approach):
  // Pass 1 — solve with straight-line burn distance to get approximate t_total
  const standoffBlockMsg = standoffError === 'invalid-standoff'
    ? 'INVALID STAND-OFF DISTANCE'
    : noWakeEnabled
      ? 'DISTANCE WITHIN NO-WAKE ZONE'
      : `DISTANCE WITHIN STAND-OFF ZONE (${standoffKm} KM)`;

  const plan1 = noWakeError
    ? { error: standoffBlockMsg }
    : computePlan({ distance_m: raw_burn_distance_m, v0_mps, a_mps2, v_arrival_mps, t_rotate_s });

  // Compute cross-track drift over the burn duration, correct the true distance
  const t_total_approx = plan1.t_total || 0;
  const cross_drift_m = Math.abs(vcrs_mps) * t_total_approx;
  const burn_distance_m = (vcrs_mps !== 0 && t_total_approx > 0)
    ? Math.sqrt(raw_burn_distance_m ** 2 + cross_drift_m ** 2)
    : raw_burn_distance_m;
  const vcrs_correction_m = burn_distance_m - raw_burn_distance_m;

  // Pass 2 — recompute with corrected distance
  const plan = noWakeError
    ? { error: standoffBlockMsg }
    : (vcrs_mps !== 0 && t_total_approx > 0)
      ? computePlan({ distance_m: burn_distance_m, v0_mps, a_mps2, v_arrival_mps, t_rotate_s })
      : plan1;

  // Reactant budget conversion
  const budget_raw = parseNum(reactantBudget);
  const budget_s = isFinite(budget_raw) && budget_raw > 0
    ? budget_raw * (reactantBudgetUnit === 'hr' ? 3600 : 60)
    : null;

  // ════════════════════════════════════════════════════════════════════
  // BUDGET / DRIFT / EFFICIENCY SOLVER
  // Phase structure: ACCEL → FLIP → DRIFT → BRAKE
  //   ACCEL: v0 → v_max     t_a=(v_max−v0)/a      d_a=(v_max²−v0²)/(2a)
  //   FLIP:  coast at v_max  t_f=t_rotate          d_f=v_max·t_f
  //   DRIFT: coast at v_max  t_dr                  d_dr=v_max·t_dr
  //   BRAKE: v_max → v_arr   t_b=(v_max−v_arr)/a   d_b=(v_max²−v_arr²)/(2a)
  // v0_mps is SIGNED: closing = +, receding = −. Sign flows through all
  // time/velocity terms exactly as the main solver does. Distances use v0²
  // (the correct NET displacement); the receding penalty appears as extra
  // accel time, which is physically correct.
  // ════════════════════════════════════════════════════════════════════

  const EFFICIENCY_TIME_MULTIPLIER = 2; // efficiency trip ≤ N× the standard-burn time

  // Build a complete drift-burn plan at a given v_max. Flip distance is
  // subtracted explicitly so the drift phase is the PURE coast and the
  // totals reconcile (fixes the earlier flip double-count).
  function buildDriftPlan(v_max) {
    const t_a = (v_max - v0_mps) / a_mps2;
    const t_b = (v_max - v_arrival_mps) / a_mps2;
    const d_a = (v_max * v_max - v0_mps * v0_mps) / (2 * a_mps2);
    const d_b = (v_max * v_max - v_arrival_mps * v_arrival_mps) / (2 * a_mps2);
    const d_f = v_max * t_rotate_s;
    const d_dr = burn_distance_m - d_a - d_f - d_b;
    if (d_dr < -1) return null; // no room for a drift phase at this v_max
    const t_dr = Math.max(0, d_dr / v_max);
    return {
      v_max,
      t_accel: t_a,
      t_rotate: t_rotate_s,
      t_drift: t_dr,
      t_brake: t_b,
      t_total: t_a + t_rotate_s + t_dr + t_b,
      d_accel: d_a,
      d_drift: Math.max(0, d_dr),
      d_brake: d_b,
    };
  }

  let driftPlan = null;        // budget-constrained drift (budget < requirement)
  let efficiencyPlan = null;   // 2×-time efficiency drift (budget > requirement)
  let budgetExceedsReq = false;

  if (budget_s !== null && !plan.error && !plan.overshoot && isFinite(a_mps2) && a_mps2 > 0) {
    // v_max achievable by burning the full budget (a·budget split accel+brake)
    const v_max_budget = (a_mps2 * budget_s + v0_mps + v_arrival_mps) / 2;
    const standard_v_max = plan.v_max || 0;

    if (v_max_budget >= standard_v_max) {
      // Budget exceeds what a standard burn needs.
      // SPEED   → standard plan (no drift) — handled downstream by using `plan`.
      // EFFICIENCY → lowest v_max such that t_total ≤ 2× standard-burn time.
      budgetExceedsReq = true;

      const T_target = EFFICIENCY_TIME_MULTIPLIER * (plan.t_total || 0);
      const P = (v0_mps + v_arrival_mps) + a_mps2 * T_target;
      const Q = a_mps2 * burn_distance_m + (v0_mps * v0_mps + v_arrival_mps * v_arrival_mps) / 2;
      const disc = P * P - 4 * Q;
      if (disc >= 0) {
        const v_eff = (P - Math.sqrt(disc)) / 2; // smaller root → lower v_max → less fuel
        // Valid only if it still requires acceleration and braking
        if (v_eff > v0_mps && v_eff > v_arrival_mps && v_eff < standard_v_max) {
          efficiencyPlan = buildDriftPlan(v_eff);
        }
      }
    } else if (v_max_budget <= v0_mps || v_max_budget <= v_arrival_mps) {
      driftPlan = { error: 'BUDGET INSUFFICIENT — CANNOT BRAKE TO TARGET VELOCITY' };
    } else {
      // Budget < requirement: drift at the budget-constrained v_max.
      const p = buildDriftPlan(v_max_budget);
      if (p) driftPlan = p;
      else { budgetExceedsReq = true; } // distance too short even here → treat as exceeds
    }
  }

  // ── Active plan selection ──
  // No budget                → standard plan
  // Budget < requirement     → driftPlan (auto, no toggle)
  // Budget > requirement:
  //     SPEED      → standard plan (no drift)
  //     EFFICIENCY → efficiencyPlan (2× time, minimum fuel)
  const hasDriftPlan = !!(driftPlan && !driftPlan.error);
  const hasEfficiencyPlan = !!efficiencyPlan;
  // Toggle only meaningful when budget exceeds AND a real efficiency plan exists
  const budgetExceedsReqWithPlan = budgetExceedsReq && hasEfficiencyPlan;

  let activePlan;
  if (budgetExceedsReqWithPlan) {
    activePlan = burnPreference === 'efficiency' ? efficiencyPlan : plan;
  } else if (hasDriftPlan) {
    activePlan = driftPlan;
  } else {
    activePlan = plan;
  }
  const isDriftMode = activePlan !== plan;

  // finalPlan is activePlan (drift mode if budget set, otherwise standard)
  const finalPlan = activePlan;

  // VCRS advisory threshold
  const vcrsRatioPct = (isFinite(vcrs_mps) && vcrs_mps !== 0 && isFinite(v0_mps) && v0_mps !== 0)
    ? (Math.abs(vcrs_mps) / Math.abs(v0_mps)) * 100
    : 0;
  const highVcrsWarning = vcrsRatioPct > 10;

  // Manual null heading + null time for high VCRS warning
  const vcrsNullTime = (highVcrsWarning && isFinite(vcrs_mps) && isFinite(a_mps2) && a_mps2 > 0)
    ? Math.abs(vcrs_mps) / a_mps2
    : null;

  const manualNullBearing = (highVcrsWarning && isFinite(vcrs_mps))
    ? (vcrs_mps >= 0 ? '90.00°' : '270.00°')
    : null;

  // ── Final Approach calculations ──
  const fa_distance_m_raw = parseNum(faDistance) * (faDistanceUnit === 'au' ? AU : faDistanceUnit === 'gm' ? 1e9 : 1000);
  const fa_brake_distance_m = isFinite(fa_distance_m_raw) ? fa_distance_m_raw - standoff_m : NaN;
  const fa_v0_mps = parseNum(faVrel) * (faVrelUnit === 'km/s' ? 1000 : 1);
  const fa_a_mps2 = parseNum(faAccel) * (faAccelUnit === 'g' ? G : 1);
  const fa_v_arrival_mps = parseNum(faVArrival) * (faVArrivalUnit === 'km/s' ? 1000 : 1);
  const fa_budget_raw = parseNum(faBudget);
  const fa_budget_s = isFinite(fa_budget_raw) && fa_budget_raw > 0
    ? fa_budget_raw * (faBudgetUnit === 'hr' ? 3600 : 60)
    : null;

  // Stand-off error for FA (mirrors burn-mode logic)
  const fa_standoffError = !standoffValid
    ? 'invalid-standoff'
    : (isFinite(fa_distance_m_raw) && fa_distance_m_raw <= standoff_m)
      ? 'within-standoff'
      : null;
  const fa_noWakeError = fa_standoffError !== null;

  const faPlan = (appMode === 'approach')
    ? (fa_standoffError === 'invalid-standoff'
        ? { error: 'INVALID STAND-OFF DISTANCE', detail: 'Enter a positive distance in km.' }
        : fa_standoffError === 'within-standoff'
          ? (noWakeEnabled
              ? { error: 'DESTINATION IS WITHIN THE 300 KM NO-WAKE ZONE', detail: 'You are already inside the no-wake boundary.' }
              : { error: `DESTINATION IS WITHIN THE STAND-OFF ZONE (${standoffKm} KM)`, detail: 'Increase total range or reduce the stand-off distance.' })
          : computeFinalApproach({ distance_m: fa_brake_distance_m, v0_mps: fa_v0_mps, a_mps2: fa_a_mps2, v_arrival_mps: fa_v_arrival_mps }))
    : null;

  // Reactant sufficiency for FA: budget_s vs t_brake
  const fa_reactant_ok = (fa_budget_s !== null && faPlan && !faPlan.error && !faPlan.overshoot)
    ? fa_budget_s >= faPlan.t_brake
    : null; // null = no budget entered, don't show

  // FA game clock
  const faParsedGameTime = parseGameTime(faGameStart);
  const faGameTimeValid = faParsedGameTime !== null;
  const faGameTimeAttempted = faGameStart.trim().length > 0;
  const faGameTimeError = faGameTimeAttempted && !faGameTimeValid;

  const faPlanOk = faPlan && !faPlan.error && !faPlan.overshoot;
  const faBrakeTarget = (faGameTimeValid && faPlanOk)
    ? addGameTime(faParsedGameTime, faPlan.t_coast)
    : null;
  const faArriveTarget = (faGameTimeValid && faPlanOk)
    ? addGameTime(faParsedGameTime, faPlan.t_total)
    : null;

  // Status for FA mode
  const faStatusText = !faPlan ? 'STANDBY'
    : faPlan.error ? 'INVALID'
    : faPlan.overshoot ? 'OVERSHOOT'
    : 'READY';

  // Flicker effect: trigger when plan output changes
  useEffect(() => {
    const key = JSON.stringify({ v_max: plan.v_max, t_accel: plan.t_accel, t_total: plan.t_total, error: plan.error });
    if (prevPlanRef.current !== null && prevPlanRef.current !== key) {
      setFlickerKey(k => k + 1);
    }
    prevPlanRef.current = key;
  }, [plan.v_max, plan.t_accel, plan.t_total, plan.error]);

  // Game time parsing
  const parsedGameTime = parseGameTime(gameStartTime);
  const gameTimeValid = parsedGameTime !== null;
  const gameTimeAttempted = gameStartTime.trim().length > 0;
  const gameTimeError = gameTimeAttempted && !gameTimeValid;

  // Game clock time at end of VCRS null burn (needs gameTimeValid/parsedGameTime)
  const vcrsNullTarget = (vcrsNullTime !== null && gameTimeValid)
    ? addGameTime(parsedGameTime, vcrsNullTime)
    : null;

  const t_accel = finalPlan.t_accel || 0;
  const t_rot = finalPlan.t_rotate || 0;
  const t_drift = finalPlan.t_drift || 0;
  const t_total = finalPlan.t_total || 0;
  const t_flip_end = t_accel + t_rot;
  const t_brake_start = isDriftMode ? t_flip_end + t_drift : t_flip_end;

  const planOk = !finalPlan.error && !finalPlan.overshoot && !plan.error && !plan.overshoot;
  const rotateTarget   = gameTimeValid && planOk ? addGameTime(parsedGameTime, t_accel) : null;
  const driftEndTarget = gameTimeValid && planOk && isDriftMode ? addGameTime(parsedGameTime, t_brake_start) : null;
  const brakeTarget    = gameTimeValid && planOk ? addGameTime(parsedGameTime, t_brake_start) : null;
  const arriveTarget   = gameTimeValid && planOk ? addGameTime(parsedGameTime, t_total) : null;

  const accelPct  = t_total ? (t_accel / t_total) * 100 : 0;
  const rotPct    = t_total ? (t_rot / t_total) * 100 : 0;
  const driftPct  = t_total && isDriftMode ? (t_drift / t_total) * 100 : 0;
  const brakePct  = t_total ? ((finalPlan.t_brake || 0) / t_total) * 100 : 0;

  const budgetInsufficient = !!(driftPlan && driftPlan.error);
  const planValid = !plan.error && !plan.overshoot && t_total > 0 && !budgetInsufficient;
  const statusText = budgetInsufficient ? 'INVALID'
    : plan.error ? 'INVALID'
    : plan.overshoot ? 'OVERSHOOT'
    : planValid ? 'READY' : 'STANDBY';

  // Combined status for header light — mode-aware
  const activeStatusText = appMode === 'approach' ? faStatusText : statusText;
  const activeHasError = appMode === 'approach'
    ? (faPlan && (faPlan.error || fa_noWakeError))
    : (plan.error || noWakeError || !!(driftPlan && driftPlan.error));
  const activeIsOvershoot = appMode === 'approach'
    ? (faPlan && faPlan.overshoot)
    : plan.overshoot;

  return (
    <>
      <style>{stylesheet}</style>
      {booting && (
        <div className={`bc-boot${bootFade ? ' fade-out' : ''}`}>
          <div className="bc-boot-inner">
            {[
              ['POLARIS ASTRONAUTICS', ''],
              ['MANUAL TORCH BURN GUIDANCE COMPUTER', 'dim'],
              ['\u00a0', 'dim'],
              ['INITIALIZING NAV SUBSYSTEM...', 'dim'],
              ['TORCH DRIVE INTERFACE........OK', 'ok'],
              ['BURN TABLE INTEGRITY.........OK', 'ok'],
              ['NO-WAKE ZONE REGISTRY........OK', 'ok'],
              ['GAME CLOCK SYNC..............OK', 'ok'],
              ['\u00a0', 'dim'],
              ['SYSTEM READY', 'ready'],
            ].map(([text, cls], i) => (
              <div key={i} className={`bc-boot-line${cls ? ' ' + cls : ''}${visibleLines.includes(i) ? ' visible' : ''}`}>
                {text}
                {cls === 'ready' && visibleLines.includes(i) && <span className="bc-boot-cursor" />}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="bc-root">
        <div className="bc-container">
          {/* HEADER */}
          <div className="bc-header">
            <div>
              <div className="bc-brand">◈ Polaris Astronautics</div>
              <div className="bc-title">Manual Torch Burn Guidance Computer</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.12em' }}>{APP_VERSION}</span>
              <span className="bc-status-wrap">
                <span className={`bc-status-light ${activeHasError ? 'invalid' : activeIsOvershoot ? 'overshoot' : 'ready'}`}></span>
                {gameTimeValid && planValid && appMode === 'burn' && <span className="bc-status-light clock" title="Game clock locked"></span>}
                {faGameTimeValid && faPlanOk && appMode === 'approach' && <span className="bc-status-light clock" title="Game clock locked"></span>}
              </span>
              <span className="bc-status-text">{activeStatusText}</span>
            </div>
          </div>

          <div className="bc-grid">
            {/* INPUTS */}
            <div className="bc-panel scratch-a">

              {/* ── Mode toggle ── */}
              <div className="bc-mode-toggle">
                <button
                  className={`bc-mode-btn${appMode === 'burn' ? ' active' : ''}`}
                  onClick={() => setAppMode('burn')}
                >◈ Burn Plan</button>
                <button
                  className={`bc-mode-btn${appMode === 'approach' ? ' active' : ''}`}
                  onClick={() => setAppMode('approach')}
                >◉ Final Approach</button>
              </div>

              {appMode === 'burn' && (
                <>
                  {/* ── Current State ── */}
                  <div className="bc-panel-header">◇ Current State</div>
                  <InputRow
                    label="Current RNG"
                    value={distance}
                    onChange={setDistance}
                    unit={distanceUnit}
                    units={['km', 'gm', 'au']}
                    onUnitChange={setDistanceUnit}
                    placeholder="e.g. 18902"
                    tooltip={{
                      desc: "After selecting your target destination, input the distance to target.",
                      img: TOOLTIP_IMG_VCRS,
                    }}
                  />
                  {noWakeError && (
                    <div className="bc-field-note" style={{ color: 'var(--red)', marginBottom: 10, paddingLeft: 118 }}>
                      {standoffError === 'invalid-standoff'
                        ? '⚠ INVALID STAND-OFF DISTANCE'
                        : noWakeEnabled
                          ? '⚠ DESTINATION IS WITHIN THE 300 KM NO-WAKE ZONE'
                          : `⚠ DESTINATION IS WITHIN THE STAND-OFF ZONE (${standoffKm} KM)`}
                    </div>
                  )}
                  <InputRow
                    label="Current VREL"
                    value={v0}
                    onChange={setV0}
                    unit={v0Unit}
                    units={['m/s', 'km/s']}
                    onUnitChange={setV0Unit}
                    placeholder="e.g. 511.19"
                    tooltip={{
                      desc: "Input your vessel's current velocity to the target. If no ETA is present, set mode to RECEDING.",
                      img: TOOLTIP_IMG_CURRENTVEL,
                    }}
                  />
                  <div style={{ display: 'flex', gap: 4, marginLeft: 118, marginBottom: 8 }}>
                    <button
                      className={`bc-unit-btn${v0Direction === 'closing' ? ' active' : ''}`}
                      onClick={() => setV0Direction('closing')}
                    >CLOSING</button>
                    <button
                      className={`bc-unit-btn${v0Direction === 'receding' ? ' active' : ''}`}
                      onClick={() => setV0Direction('receding')}
                      style={{ color: v0Direction === 'receding' ? 'var(--red)' : undefined,
                               borderColor: v0Direction === 'receding' ? 'var(--red)' : undefined,
                               background: v0Direction === 'receding' ? 'rgba(255,93,93,0.15)' : undefined }}
                    >RECEDING</button>
                  </div>
                  <InputRow
                    label="Current VCRS"
                    value={vcrs}
                    onChange={setVcrs}
                    unit={vcrsUnit}
                    units={['m/s', 'km/s']}
                    onUnitChange={setVcrsUnit}
                    placeholder="e.g. -0.02"
                    tooltip={{
                      desc: "Input your VCRS to the target destination.",
                      img: TOOLTIP_IMG_DISTANCE,
                    }}
                  />

                  {/* ── Arrival Parameters ── */}
                  <div className="bc-panel-header" style={{ marginTop: 20 }}>◇ Arrival Parameters</div>
                  <InputRow
                    label={noWakeEnabled ? 'Tgt Vel at 300km' : `Tgt Vel at ${standoffKm || '?'}km`}
                    value={vArrival}
                    onChange={setVArrival}
                    unit={vArrivalUnit}
                    units={['m/s', 'km/s']}
                    onUnitChange={setVArrivalUnit}
                    placeholder="e.g. 0"
                  />
                  <StandoffControl
                    noWakeEnabled={noWakeEnabled}
                    setNoWakeEnabled={setNoWakeEnabled}
                    standoffKm={standoffKm}
                    setStandoffKm={setStandoffKm}
                  />
                  <InputRow
                    label="Reactant Budget"
                    value={reactantBudget}
                    onChange={setReactantBudget}
                    unit={reactantBudgetUnit}
                    units={['hr', 'min']}
                    onUnitChange={setReactantBudgetUnit}
                    placeholder="Optional"
                  />
                  {(isDriftMode && !budgetExceedsReqWithPlan) || budgetExceedsReqWithPlan || budgetExceedsReq || (driftPlan && driftPlan.error) ? (
                    <div className="bc-field-note" style={{ marginBottom: 4, paddingLeft: 118 }}>
                      {isDriftMode && !budgetExceedsReqWithPlan
                        ? <span style={{ color: 'var(--amber)' }}>◈ DRIFT MODE ACTIVE</span>
                        : budgetExceedsReqWithPlan
                          ? <span style={{ color: 'var(--green)' }}>● BUDGET EXCEEDS REQUIREMENT — SELECT PREFERENCE</span>
                          : budgetExceedsReq
                            ? <span style={{ color: 'var(--green)' }}>● BUDGET EXCEEDS REQUIREMENT — STANDARD BURN USED</span>
                            : <span style={{ color: 'var(--red)' }}>{driftPlan.error}</span>}
                    </div>
                  ) : null}
                  {budgetExceedsReqWithPlan && (
                    <>
                      <div style={{ display: 'flex', gap: 4, marginLeft: 118, marginBottom: 4 }}>
                        <button
                          className={`bc-unit-btn${burnPreference === 'speed' ? ' active' : ''}`}
                          onClick={() => setBurnPreference('speed')}
                        >SPEED</button>
                        <button
                          className={`bc-unit-btn${burnPreference === 'efficiency' ? ' active' : ''}`}
                          onClick={() => setBurnPreference('efficiency')}
                        >EFFICIENCY</button>
                      </div>
                      <div className="bc-field-note" style={{ marginBottom: 8, paddingLeft: 118 }}>
                        {burnPreference === 'speed'
                          ? <span style={{ color: 'var(--amber)' }}>◈ STANDARD BURN — FASTEST ARRIVAL, NO DRIFT</span>
                          : <span style={{ color: 'var(--cyan)' }}>◈ DRIFT MODE — 2× TIME, MINIMUM REACTANT</span>}
                      </div>
                    </>
                  )}

                  {/* ── Vessel Parameters ── */}
                  <div className="bc-panel-header" style={{ marginTop: 20 }}>◇ Vessel Parameters</div>
                  <InputRow
                    label="Acceleration"
                    value={accel}
                    onChange={setAccel}
                    unit={accelUnit}
                    units={['g', 'm/s²']}
                    onUnitChange={setAccelUnit}
                    placeholder="e.g. 1.95"
                  />
                  <InputRow
                    label="Flip Time"
                    value={flipTime}
                    onChange={setFlipTime}
                    unit="sec"
                    units={['sec']}
                    onUnitChange={() => {}}
                    placeholder="e.g. 30"
                  />

                  {/* ── Game Clock ── */}
                  <div className="bc-panel-header" style={{ marginTop: 20 }}>◇ Game Clock</div>
                  <div className="bc-input-row">
                    <div className="bc-label">
                      <Clock size={10} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                      Burn Start
                    </div>
                    <input
                      className={`bc-input ${gameTimeError ? 'invalid' : ''}`}
                      type="text"
                      placeholder="YYYY-MM-DD HH:MM:SS or HH:MM:SS"
                      value={gameStartTime}
                      onChange={(e) => setGameStartTime(e.target.value)}
                    />
                  </div>
                  <div className="bc-field-note" style={{ marginTop: 6, paddingLeft: 118 }}>
                    {gameTimeError ? (
                      <span style={{ color: 'var(--red)' }}>INVALID FORMAT — USE YYYY-MM-DD HH:MM:SS OR HH:MM:SS</span>
                    ) : gameTimeValid ? (
                      <span style={{ color: 'var(--green)' }}>● TARGETS COMPUTED FROM GAME CLOCK</span>
                    ) : (
                      <span>LEAVE BLANK FOR RELATIVE (T+) TIMES — DATE OPTIONAL</span>
                    )}
                  </div>
                </>
              )}

              {appMode === 'approach' && (
                <>
                  {/* ── Current State ── */}
                  <div className="bc-panel-header">◇ Current State</div>
                  <div className="bc-fa-notice">
                    VCRS SHOULD BE 0.00 M/S BEFORE FINAL APPROACH — NULL CROSS-TRACK VELOCITY BEFORE PROCEEDING
                  </div>
                  <InputRow
                    label="Current RNG"
                    value={faDistance}
                    onChange={setFaDistance}
                    unit={faDistanceUnit}
                    units={['km', 'gm', 'au']}
                    onUnitChange={setFaDistanceUnit}
                    placeholder="e.g. 18902"
                  />
                  {fa_noWakeError && (
                    <div className="bc-field-note" style={{ color: 'var(--red)', marginBottom: 10, paddingLeft: 118 }}>
                      {fa_standoffError === 'invalid-standoff'
                        ? '⚠ INVALID STAND-OFF DISTANCE'
                        : noWakeEnabled
                          ? '⚠ DESTINATION IS WITHIN THE 300 KM NO-WAKE ZONE'
                          : `⚠ DESTINATION IS WITHIN THE STAND-OFF ZONE (${standoffKm} KM)`}
                    </div>
                  )}
                  <InputRow
                    label="Current VREL (Closing)"
                    value={faVrel}
                    onChange={setFaVrel}
                    unit={faVrelUnit}
                    units={['m/s', 'km/s']}
                    onUnitChange={setFaVrelUnit}
                    placeholder="e.g. 511.19"
                  />

                  {/* ── Arrival Parameters ── */}
                  <div className="bc-panel-header" style={{ marginTop: 20 }}>◇ Arrival Parameters</div>
                  <InputRow
                    label={noWakeEnabled ? 'Tgt Vel at 300km' : `Tgt Vel at ${standoffKm || '?'}km`}
                    value={faVArrival}
                    onChange={setFaVArrival}
                    unit={faVArrivalUnit}
                    units={['m/s', 'km/s']}
                    onUnitChange={setFaVArrivalUnit}
                    placeholder="e.g. 0"
                  />
                  <StandoffControl
                    noWakeEnabled={noWakeEnabled}
                    setNoWakeEnabled={setNoWakeEnabled}
                    standoffKm={standoffKm}
                    setStandoffKm={setStandoffKm}
                  />
                  <InputRow
                    label="Budget"
                    value={faBudget}
                    onChange={setFaBudget}
                    unit={faBudgetUnit}
                    units={['hr', 'min']}
                    onUnitChange={setFaBudgetUnit}
                    placeholder="Optional"
                  />

                  {/* ── Vessel Parameters ── */}
                  <div className="bc-panel-header" style={{ marginTop: 20 }}>◇ Vessel Parameters</div>
                  <InputRow
                    label="Acceleration"
                    value={faAccel}
                    onChange={setFaAccel}
                    unit={faAccelUnit}
                    units={['g', 'm/s²']}
                    onUnitChange={setFaAccelUnit}
                    placeholder="e.g. 1.95"
                  />

                  {/* ── Game Clock ── */}
                  <div className="bc-panel-header" style={{ marginTop: 20 }}>◇ Game Clock</div>
                  <div className="bc-input-row">
                    <div className="bc-label">
                      <Clock size={10} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                      Current Time
                    </div>
                    <input
                      className={`bc-input ${faGameTimeError ? 'invalid' : ''}`}
                      type="text"
                      placeholder="YYYY-MM-DD HH:MM:SS or HH:MM:SS"
                      value={faGameStart}
                      onChange={(e) => setFaGameStart(e.target.value)}
                    />
                  </div>
                  <div className="bc-field-note" style={{ marginTop: 6, paddingLeft: 118 }}>
                    {faGameTimeError ? (
                      <span style={{ color: 'var(--red)' }}>INVALID FORMAT — USE YYYY-MM-DD HH:MM:SS OR HH:MM:SS</span>
                    ) : faGameTimeValid ? (
                      <span style={{ color: 'var(--green)' }}>● TARGETS COMPUTED FROM GAME CLOCK</span>
                    ) : (
                      <span>LEAVE BLANK FOR RELATIVE (T+) TIMES — DATE OPTIONAL</span>
                    )}
                  </div>
                </>
              )}

            </div>

            {/* RIGHT COLUMN — mode-conditional */}
            {appMode === 'burn' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="bc-panel scratch-b">
              <div className="bc-panel-header">◇ Burn Solution</div>

              {plan.error && (
                <div className="bc-warning">
                  <AlertTriangle size={14} color="var(--red)" />
                  <div className="bc-warning-text">
                    <strong>{plan.error}</strong>
                    {plan.detail && <><br />{plan.detail}</>}
                  </div>
                </div>
              )}

              {plan.overshoot && (
                <div className="bc-warning">
                  <AlertTriangle size={14} color="var(--red)" />
                  <div className="bc-warning-text">
                    <strong>CANNOT BRAKE IN TIME</strong><br />
                    {noWakeEnabled
                      ? 'Ship is moving too fast to stop before the no-wake boundary.'
                      : `Ship is moving too fast to stop before the stand-off boundary (${standoffKm} km).`}<br />
                    Minimum brake distance needed: <strong>{formatDistance(plan.brake_only_dist)}</strong><br />
                    Shortfall: <strong>{formatDistance(plan.shortfall)}</strong><br />
                    Reduce current velocity, lower cutoff speed, or increase distance.
                  </div>
                </div>
              )}

              {plan.flip_now && !plan.error && !plan.overshoot && (
                <div className="bc-info">
                  <strong>ROTATE NOW</strong> — at or past geometric flip point. Begin rotation immediately.
                </div>
              )}

              {highVcrsWarning && !plan.error && !plan.overshoot && (
                <>
                  <div className="bc-advisory">
                    <strong>HIGH VCRS DETECTED</strong> — Cross-track velocity is {vcrsRatioPct.toFixed(1)}% of relative velocity. RCS correction will not be sufficient at this magnitude.
                  </div>
                  {manualNullBearing && (
                    <Readout
                      label="Manual Null Heading"
                      value={manualNullBearing}
                      highlight
                      flickerKey={flickerKey}
                    />
                  )}
                  {vcrsNullTime !== null && (
                    <>
                      <Readout
                        label="VCRS Null Until"
                        value={vcrsNullTarget ? formatGameTime(vcrsNullTarget) : formatTime(Math.floor(vcrsNullTime))}
                        highlight
                        flickerKey={flickerKey}
                      />
                      {vcrsNullTarget && (
                        <div className="bc-field-note" style={{ textAlign: 'right', marginBottom: 4 }}>
                          DURATION: {formatTime(Math.floor(vcrsNullTime))}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--amber)', letterSpacing: '0.1em', marginBottom: 8, marginTop: 6, textAlign: 'right', lineHeight: 1.6 }}>
                        BURN AT {manualNullBearing} FOR THIS DURATION — THEN RE-ENTER VALUES FOR A FRESH BURN PLAN
                      </div>
                    </>
                  )}
                </>
              )}

              {!plan.error && !plan.overshoot && !budgetInsufficient && (
                <>
                  {/* ── Section 1: Key targets ── */}
                  <Readout
                    label={isDriftMode ? 'End Accel / Begin Flip' : 'Begin Rotate'}
                    value={gameTimeValid ? formatGameTime(rotateTarget) : `T+${formatTime(t_accel)}`}
                    highlight flickerKey={flickerKey}
                  />
                  {isDriftMode && (
                    <Readout
                      label="End Drift / Begin Brake"
                      value={gameTimeValid ? formatGameTime(driftEndTarget) : `T+${formatTime(t_brake_start)}`}
                      highlight flickerKey={flickerKey}
                    />
                  )}
                  {!isDriftMode && (
                    <Readout
                      label="Begin Brake"
                      value={gameTimeValid ? formatGameTime(brakeTarget) : `T+${formatTime(t_brake_start)}`}
                      highlight flickerKey={flickerKey}
                    />
                  )}
                  <Readout
                    label="Arrival"
                    value={gameTimeValid ? formatGameTime(arriveTarget) : `T+${formatTime(t_total)}`}
                    highlight flickerKey={flickerKey}
                  />
                  <Readout
                    label="Accel Duration"
                    value={formatTime(Math.floor(t_accel))}
                    highlight flickerKey={flickerKey}
                  />
                  {isDriftMode && (
                    <Readout label="Drift Duration" value={formatTime(Math.floor(finalPlan.t_drift || 0))} highlight flickerKey={flickerKey} />
                  )}
                  <Readout
                    label="Brake Duration"
                    value={formatTime(Math.floor(t_total) - Math.floor(t_brake_start))}
                    highlight flickerKey={flickerKey}
                  />

                  {/* ── Divider ── */}
                  {vcrs_correction_m >= burn_distance_m * 0.001 && (
                    <div className="bc-info" style={{ marginTop: 10 }}>
                      <strong>CROSS-TRACK CORRECTION APPLIED</strong> — burn distance extended by {formatDistance(vcrs_correction_m)} due to VCRS drift over burn duration.
                    </div>
                  )}
                </>
              )}
            </div>

            {/* BURN REFERENCE — right column, below Burn Solution */}
            {planValid && (
              <div className="bc-panel scratch-b">
                <div className="bc-panel-header">◇ Burn Reference</div>
                <Readout label="Accel Distance" value={formatDistance(finalPlan.d_accel)} highlight flickerKey={flickerKey} />
                {isDriftMode && (
                  <Readout label="Drift Distance" value={formatDistance(finalPlan.d_drift)} highlight flickerKey={flickerKey} />
                )}
                <Readout label="Brake Distance" value={formatDistance(finalPlan.d_brake)} highlight flickerKey={flickerKey} />
                <Readout label="Total Distance" value={formatDistance(burn_distance_m)} highlight flickerKey={flickerKey} />
                <Readout label="Peak Velocity" value={formatVelocity(finalPlan.v_max)} highlight flickerKey={flickerKey} />
              </div>
            )}
            </div>
            )}

            {/* FINAL APPROACH results */}
            {appMode === 'approach' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="bc-panel scratch-b">
                <div className="bc-panel-header">◇ Approach Solution</div>

                {faPlan && faPlan.error && (
                  <div className="bc-warning">
                    <AlertTriangle size={14} color="var(--red)" />
                    <div className="bc-warning-text">
                      <strong>{faPlan.error}</strong>
                      {faPlan.detail && <><br />{faPlan.detail}</>}
                    </div>
                  </div>
                )}

                {faPlan && faPlan.overshoot && (
                  <div className="bc-warning">
                    <AlertTriangle size={14} color="var(--red)" />
                    <div className="bc-warning-text">
                      <strong>CANNOT BRAKE IN TIME — OVERSHOOT IMMINENT</strong><br />
                      At {formatVelocity(fa_v0_mps)} closing, you cannot stop before the {noWakeEnabled ? 'no-wake boundary' : `stand-off boundary (${standoffKm} km)`} at {formatDistance(fa_a_mps2 > 0 ? (fa_v0_mps * fa_v0_mps - (isFinite(fa_v_arrival_mps) ? fa_v_arrival_mps * fa_v_arrival_mps : 0)) / (2 * fa_a_mps2) : 0)} brake distance needed.<br />
                      Shortfall: <strong>{isFinite(faPlan.shortfall) ? formatDistance(faPlan.shortfall) : '—'}</strong><br />
                      Required deceleration: <strong>{isFinite(faPlan.required_a) ? (faPlan.required_a / G).toFixed(2) + ' G' : '—'}</strong> — exceeds available {isFinite(fa_a_mps2) ? (fa_a_mps2 / G).toFixed(2) + ' G' : '—'}.<br />
                      The solver cannot recover this approach. Reduce closing velocity immediately if possible.
                    </div>
                  </div>
                )}

                {faPlanOk && (
                  <>
                    {/* Required G vs available G */}
                    {(() => {
                      const req_g = faPlan.required_a / G;
                      const avail_g = fa_a_mps2 / G;
                      const gOk = isFinite(req_g) && isFinite(avail_g) && req_g <= avail_g;
                      return (
                        <div className={gOk ? 'bc-fa-ok' : 'bc-fa-warn'}>
                          {gOk
                            ? `● DECELERATION OK — REQUIRED: ${req_g.toFixed(2)} G / AVAILABLE: ${avail_g.toFixed(2)} G`
                            : `⚠ DECELERATION MARGINAL — REQUIRED: ${req_g.toFixed(2)} G / AVAILABLE: ${avail_g.toFixed(2)} G — EXCEEDING RATED THRUST IS RISKY`}
                        </div>
                      );
                    })()}

                    {/* Reactant sufficiency */}
                    {fa_reactant_ok !== null && (
                      <div className={fa_reactant_ok ? 'bc-fa-ok' : 'bc-fa-warn'}>
                        {fa_reactant_ok
                          ? `● REACTANT SUFFICIENT — BRAKE REQUIRES ${formatTime(Math.floor(faPlan.t_brake))}, BUDGET IS ${formatTime(Math.floor(fa_budget_s))}`
                          : `⚠ REACTANT DEFICIT — BRAKE REQUIRES ${formatTime(Math.floor(faPlan.t_brake))}, BUDGET IS ONLY ${formatTime(Math.floor(fa_budget_s))}`}
                      </div>
                    )}

                    {faPlan.t_coast > 1 ? (
                      <>
                        <Readout
                          label="Begin Brake"
                          value={faGameTimeValid ? formatGameTime(faBrakeTarget) : `T+${formatTime(Math.floor(faPlan.t_coast))}`}
                          highlight flickerKey={flickerKey}
                        />
                        {faBrakeTarget && (
                          <div className="bc-field-note" style={{ textAlign: 'right', marginBottom: 4 }}>
                            COAST {formatTime(Math.floor(faPlan.t_coast))} BEFORE IGNITION
                          </div>
                        )}
                        {!faGameTimeValid && (
                          <div className="bc-field-note" style={{ textAlign: 'right', marginBottom: 4 }}>
                            COAST {formatTime(Math.floor(faPlan.t_coast))} BEFORE IGNITION
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="bc-fa-warn" style={{ marginBottom: 8 }}>
                        ⚠ BRAKE NOW — YOU ARE AT OR PAST THE BRAKE INITIATION POINT
                      </div>
                    )}

                    <Readout
                      label="Arrival"
                      value={faGameTimeValid ? formatGameTime(faArriveTarget) : `T+${formatTime(Math.floor(faPlan.t_total))}`}
                      highlight flickerKey={flickerKey}
                    />
                    <Readout
                      label="Brake Duration"
                      value={formatTime(Math.floor(faPlan.t_brake))}
                      highlight flickerKey={flickerKey}
                    />
                    <Readout
                      label="Brake Distance"
                      value={formatDistance(faPlan.d_brake)}
                      highlight flickerKey={flickerKey}
                    />
                    {faPlan.d_coast > 0 && (
                      <Readout
                        label="Coast Distance"
                        value={formatDistance(faPlan.d_coast)}
                        highlight flickerKey={flickerKey}
                      />
                    )}
                  </>
                )}

                {!faPlan && (
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', letterSpacing: '0.08em', padding: '12px 0' }}>
                    ENTER APPROACH PARAMETERS TO COMPUTE SOLUTION
                  </div>
                )}
              </div>
            </div>
            )}

          </div>

          {/* TIMELINE + GAME-TIME TARGETS — burn mode only */}
          {appMode === 'burn' && (
            <div className="bc-panel bc-timeline-panel scratch-c">
              <div className="bc-panel-header">◇ Burn Timeline</div>

              <div className="bc-timeline">
                {planValid ? (
                  <>
                    {t_accel > 0 && (
                      <div className="bc-timeline-phase accel" style={{ left: 0, width: `${accelPct}%` }}>
                        {accelPct > 8 ? 'ACCEL' : ''}
                      </div>
                    )}
                    {t_rot > 0 && (
                      <div className="bc-timeline-phase rotate" style={{ left: `${accelPct}%`, width: `${rotPct}%` }}>
                        {rotPct > 6 ? 'ROT' : ''}
                      </div>
                    )}
                    {isDriftMode && driftPct > 0 && (
                      <div className="bc-timeline-phase drift" style={{ left: `${accelPct + rotPct}%`, width: `${driftPct}%` }}>
                        {driftPct > 8 ? 'DRIFT' : ''}
                      </div>
                    )}
                    <div className="bc-timeline-phase brake" style={{ left: `${accelPct + rotPct + driftPct}%`, width: `${brakePct}%` }}>
                      {brakePct > 8 ? 'BRAKE' : ''}
                    </div>
                    <div className="bc-timeline-tick" style={{ left: 0 }}>T+0</div>
                    {t_accel > 0 && rotPct >= 10 && (
                      <div className="bc-timeline-tick key" style={{ left: `${accelPct}%` }}>↺ FLIP</div>
                    )}
                    {isDriftMode && driftPct >= 5 && (
                      <div className="bc-timeline-tick key" style={{ left: `${accelPct + rotPct + driftPct}%` }}>⊖ BRAKE</div>
                    )}
                    {!isDriftMode && t_accel > 0 && rotPct >= 10 && (
                      <div className="bc-timeline-tick key" style={{ left: `${accelPct + rotPct}%` }}>⊖ BRAKE</div>
                    )}
                    {!isDriftMode && t_accel > 0 && rotPct < 10 && (
                      <div className="bc-timeline-tick key" style={{ left: `${accelPct + rotPct / 2}%` }}>↺→⊖ FLIP</div>
                    )}
                    {t_accel === 0 && (
                      <div className="bc-timeline-tick key" style={{ left: `${rotPct}%` }}>⊖ BRAKE</div>
                    )}
                    <div className="bc-timeline-tick" style={{ left: '100%', transform: 'translateX(-100%)' }}>◉ ARRIVE</div>
                  </>
                ) : (
                  <>
                    <div className="bc-timeline-phase accel" style={{ left: 0, width: '33.33%' }}>?</div>
                    <div className="bc-timeline-phase rotate" style={{ left: '33.33%', width: '33.34%' }}>?</div>
                    <div className="bc-timeline-phase brake" style={{ left: '66.67%', width: '33.33%' }}>?</div>
                    <div className="bc-timeline-tick" style={{ left: 0 }}>T+0</div>
                    <div className="bc-timeline-tick" style={{ left: '100%', transform: 'translateX(-100%)' }}>◉ ARRIVE</div>
                  </>
                )}
              </div>

              <div className="bc-targets-grid">
                <TargetCell
                  variant="rotate"
                  label={planValid ? (isDriftMode ? '↺ End Accel / Flip' : '↺ Begin Rotate') : '↺ Begin Rotate'}
                  gameTime={planValid ? rotateTarget : null}
                  relative={planValid ? `T+${formatTime(t_accel)}` : '--:--:--'}
                />
                <TargetCell
                  variant="brake"
                  label={planValid ? (isDriftMode ? '⊖ End Drift / Brake' : '⊖ Begin Brake') : '⊖ Begin Brake'}
                  gameTime={planValid ? (isDriftMode ? driftEndTarget : brakeTarget) : null}
                  relative={planValid ? `T+${formatTime(t_brake_start)}` : '--:--:--'}
                />
                <TargetCell
                  variant="arrive"
                  label="◉ Arrival"
                  gameTime={planValid ? arriveTarget : null}
                  relative={planValid ? `T+${formatTime(t_total)}` : '--:--:--'}
                />
              </div>

              {planValid && !gameTimeValid && (
                <div style={{ marginTop: 12, fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.1em', textAlign: 'center' }}>
                  ▲ ENTER GAME CLOCK TIME ABOVE FOR ABSOLUTE TARGET TIMES ▲
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </>
  );
}

// ───── subcomponents ───────────────────────────────────────────────────

function InputRow({ label, value, onChange, unit, units, onUnitChange, tooltip, placeholder }) {
  const [showTip, setShowTip] = React.useState(false);
  const [tipPos, setTipPos] = React.useState({ top: 0, left: 0 });
  const badgeRef = React.useRef(null);

  const handleMouseEnter = () => {
    if (badgeRef.current) {
      const rect = badgeRef.current.getBoundingClientRect();
      const tipHeight = Math.min(window.innerHeight * 0.8, 600);
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      let top;
      if (spaceBelow >= tipHeight || spaceBelow >= spaceAbove) {
        top = rect.bottom + 6;
      } else {
        top = Math.max(8, rect.top - tipHeight - 6);
      }
      setTipPos({ top, left: rect.left });
    }
    setShowTip(true);
  };

  return (
    <div className="bc-input-row">
      <div className="bc-label">
        {label}
        {tooltip && (
          <span
            className="bc-tooltip-wrap"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={() => setShowTip(false)}
          >
            <span className="bc-tooltip-badge" ref={badgeRef}>?</span>
            {showTip && (
              <div className="bc-tooltip-card" style={{ top: tipPos.top, left: tipPos.left }}>
                <div className="bc-tooltip-header">{label}</div>
                <div className="bc-tooltip-desc">{tooltip.desc}</div>
                {tooltip.img && (
                  <img
                    className="bc-tooltip-img"
                    src={tooltip.img}
                    alt={label}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                )}
              </div>
            )}
          </span>
        )}
      </div>
      <input
        className="bc-input"
        type="text"
        inputMode="decimal"
        value={value}
        placeholder={placeholder || ''}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="bc-unit-toggle">
        {units.map((u) => (
          <button
            key={u}
            className={`bc-unit-btn ${unit === u ? 'active' : ''}`}
            onClick={() => onUnitChange(u)}
          >
            {u}
          </button>
        ))}
      </div>
    </div>
  );
}

function Readout({ label, value, highlight, dim, flickerKey }) {
  const [animClass, setAnimClass] = React.useState('');
  const isFirst = React.useRef(true);
  React.useEffect(() => {
    if (isFirst.current) { isFirst.current = false; return; }
    setAnimClass('flicker');
    const t = setTimeout(() => setAnimClass(''), 200);
    return () => clearTimeout(t);
  }, [flickerKey]);
  const cls = [highlight ? 'highlight' : dim ? 'dim' : '', animClass].filter(Boolean).join(' ');
  return (
    <div className="bc-readout">
      <div className="bc-readout-label">{label}</div>
      <div className={`bc-readout-value ${cls}`}>{value}</div>
    </div>
  );
}

function TargetCell({ variant, label, gameTime, relative }) {
  const displayGameTime = formatGameTime(gameTime);
  const hasGameTime = displayGameTime !== null;
  const hasDate = gameTime && gameTime.hasDate;
  return (
    <div className={`bc-target-cell ${variant}`}>
      <div className="bc-target-label">{label}</div>
      {hasGameTime ? (
        <>
          {hasDate ? (
            <>
              <div className="bc-target-date">{gameTime.dateStr}</div>
              <div className="bc-target-time game-time">{gameTime.timeStr}</div>
            </>
          ) : (
            <div className="bc-target-time game-time">{displayGameTime}</div>
          )}
          <div className="bc-target-relative">{relative}</div>
        </>
      ) : (
        <div className="bc-target-time">{relative}</div>
      )}
    </div>
  );
}