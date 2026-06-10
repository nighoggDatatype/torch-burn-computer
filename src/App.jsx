import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, Clock } from 'lucide-react';

const APP_VERSION = 'v0.3.0';

const G = 9.80665; // standard gravity, m/s²
const AU = 149_597_870_700; // meters per astronomical unit

// ───── helpers ─────────────────────────────────────────────────────────

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
    if (h > 24 || mi > 59 || s > 59) return null;
    return { date: { y, mo, d }, seconds: h * 3600 + mi * 60 + s };
  }
  // Try time-only: HH:MM:SS or HH:MM
  const parts = str.split(':').map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !isFinite(n) || n < 0)) return null;
  const [h, mi, s = 0] = nums;
  if (h > 24 || mi > 59 || s > 59) return null;
  return { date: null, seconds: h * 3600 + mi * 60 + s };
}

function daysInMonth(mo, y) {
  return new Date(y, mo, 0).getDate();
}

function addGameTime(base, offsetSeconds) {
  if (base == null || !isFinite(offsetSeconds)) return null;
  const DAY = 25 * 3600; // 25h in-game day including untime
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
  animation: bc-blink-hard 1s steps(1, end) infinite;
}
.bc-status-light.invalid {
  background: #ff5d5d;
  box-shadow: 0 0 6px #ff5d5d;
  animation: none;
}
.bc-status-light.overshoot {
  background: #ff5d5d;
  box-shadow: 0 0 8px #ff5d5d;
  animation: bc-pulse-fast 0.5s ease-in-out infinite;
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
const TOOLTIP_IMG_DISTANCE   = "data:image/png;base64,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";
const TOOLTIP_IMG_CURRENTVEL = "data:image/png;base64,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JAWXZvvze+cSfmK1FZdm+/N75xJ+YrLirIuk3ZEREWI0BERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREBqOE7zUfm8f5QpaiYTvNR+bx/lClr1YbIxO4XibuR5V7XibuR5VLIRNyHujfNRMh7o3zUREu5z7VmGvC6SWRrQB41IxthlrAxzxndrnO2/k4j/RYray2QlaWTSEH499x9K1XQBJ0BRJJJLpNyf+8cqYJueKhbFLyqp00RFeUhZdm+/N75xJ+YrUVl2b783vnEn5isuKsi6TdkRERYjQEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQGo4TvNR+bx/lClqJhO81H5vH+UKWvVhsjE7heJu5HlXteJu5HlUshE3Ie6N81EyHujfNRES7mOzUXWaRMkDon8PFHxEb/EtE6Pv7v6HnSf5jlTMrYZUpueZCX8Ozd+snZXPo+/u/oedJ/mOWLD+8ap3unUREW4yBZdm+/N75xJ+YrUVl2b783vnEn5isuKsi6TdkRERYjQEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQGo4TvNR+bx/lClqJhO81H5vH+UKWvVhsjE7heJu5HlXteJu5HlUshE3Ie6N81EyHujfNRES7mATzzTv45pHPd4yVsPR9/d/Q86T/McsaWy9H3939DzpP8AMcsWH941TvdOoiItxkCy7N9+b3ziT8xWorLs335vfOJPzFZcVZF0m7IiIixGgIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgCIiAIiIAiIgNRwneaj83j/KFLUTCd5qPzeP8oUterDZGJ3C8TdyPKva8TdyPKpZCJuQ90b5qJkPdG+aiIl3P58Wy9H3939DzpP8xyxyWOSJ5ZLG5jh1hw2K2Po+/u/oedJ/mOWLD+8ap3unUREW4yBZdm+/N75xJ+YrUVl2b783vnEn5isuKsi6TdkRERYjQEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQGo4TvNR+bx/lClqJhO81H5vH+UKWvVhsjE7heJu5HlXteJu5HlUshE3Ie6N81EyHujfNRES7mW5KvXyOPcWPZI9rd43tPhV06Pv7v6HnSf5jlT8nPWx9J72RQxOdvwhj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";
const TOOLTIP_IMG_VCRS       = "data:image/png;base64,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";

export default function BurnCalculator() {
  // ── boot sequence state ──
  const [booting, setBooting] = useState(() => !sessionStorage.getItem('pa_booted'));
  const [bootFade, setBootFade] = useState(false);
  const [visibleLines, setVisibleLines] = useState([]);

  useEffect(() => {
    if (!booting) return;
    sessionStorage.setItem('pa_booted', '1');
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
  const [flipTime, setFlipTime] = useState('');
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
  const standoff_m = noWakeEnabled ? NO_WAKE_M : (parseFloat(standoffKm) * 1000 || 0);
  const standoffValid = noWakeEnabled || (isFinite(parseFloat(standoffKm)) && parseFloat(standoffKm) > 0);
  const distance_m = parseFloat(distance) * (distanceUnit === 'au' ? AU : distanceUnit === 'gm' ? 1e9 : distanceUnit === 'km' ? 1000 : 1);
  const raw_burn_distance_m = distance_m - standoff_m; // before VCRS correction
  const v0_mps = parseFloat(v0) * (v0Unit === 'km/s' ? 1000 : 1) * (v0Direction === 'receding' ? -1 : 1);
  const a_mps2 = parseFloat(accel) * (accelUnit === 'g' ? G : 1);
  const t_rotate_s = parseFloat(flipTime);
  const v_arrival_mps = parseFloat(vArrival) * (vArrivalUnit === 'km/s' ? 1000 : 1);
  const vcrs_mps = vcrs.trim() !== '' ? parseFloat(vcrs) * (vcrsUnit === 'km/s' ? 1000 : 1) : 0;

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
  const budget_raw = parseFloat(reactantBudget);
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
  const fa_distance_m_raw = parseFloat(faDistance) * (faDistanceUnit === 'au' ? AU : faDistanceUnit === 'gm' ? 1e9 : 1000);
  const fa_brake_distance_m = isFinite(fa_distance_m_raw) ? fa_distance_m_raw - standoff_m : NaN;
  const fa_v0_mps = parseFloat(faVrel) * (faVrelUnit === 'km/s' ? 1000 : 1);
  const fa_a_mps2 = parseFloat(faAccel) * (faAccelUnit === 'g' ? G : 1);
  const fa_v_arrival_mps = parseFloat(faVArrival) * (faVArrivalUnit === 'km/s' ? 1000 : 1);
  const fa_budget_raw = parseFloat(faBudget);
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

  const planValid = !plan.error && !plan.overshoot && t_total > 0;
  const statusText = (driftPlan && driftPlan.error) ? 'INVALID'
    : plan.error ? 'INVALID'
    : plan.overshoot ? 'OVERSHOOT'
    : planValid ? 'READY' : 'STANDBY';

  // Combined status for header light — mode-aware
  const activeStatusText = appMode === 'approach' ? faStatusText : statusText;
  const activeHasError = appMode === 'approach'
    ? (faPlan && (faPlan.error || fa_noWakeError))
    : (plan.error || noWakeError);
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
                >⬛ Burn Plan</button>
                <button
                  className={`bc-mode-btn${appMode === 'approach' ? ' active' : ''}`}
                  onClick={() => setAppMode('approach')}
                >◉ Final Approach</button>
              </div>

              {appMode === 'burn' && (
                <>
                  <div className="bc-panel-header">◇ Trip Parameters</div>
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
                      desc: "Input your VCRS to the target destination. NOTE: During the braking phase, a VCRS correction will likely be required.",
                      img: TOOLTIP_IMG_DISTANCE,
                    }}
                  />
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
                  <div className="bc-panel-header" style={{ marginTop: 20 }}>◇ Reactant Budget</div>
                  <InputRow
                    label="Budget"
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
                  <InputRow
                    label={noWakeEnabled ? 'Tgt Vel at 300km' : `Tgt Vel at ${standoffKm || '?'}km`}
                    value={vArrival}
                    onChange={setVArrival}
                    unit={vArrivalUnit}
                    units={['m/s', 'km/s']}
                    onUnitChange={setVArrivalUnit}
                    placeholder="e.g. 0"
                  />
                  {/* NO-WAKE ZONE TOGGLE */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 118, marginBottom: 8 }}>
                    <button
                      className={`bc-unit-btn${noWakeEnabled ? ' active' : ''}`}
                      onClick={() => setNoWakeEnabled(true)}
                    >300KM ZONE ON</button>
                    <button
                      className={`bc-unit-btn${!noWakeEnabled ? ' active' : ''}`}
                      onClick={() => setNoWakeEnabled(false)}
                      style={!noWakeEnabled ? { color: 'var(--cyan)', borderColor: 'var(--cyan)', background: 'rgba(77,208,255,0.12)' } : {}}
                    >300KM ZONE OFF</button>
                  </div>
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
                  <div className="bc-field-note" style={{ marginBottom: 4, paddingLeft: 118 }}>
                    {noWakeEnabled
                      ? <span>300 KM NO-WAKE ZONE SUBTRACTED FROM RANGE</span>
                      : <span style={{ color: 'var(--cyan)' }}>{`◈ STAND-OFF: ${standoffKm || '?'} KM SUBTRACTED FROM RANGE`}</span>}
                  </div>

                  {/* GAME TIME */}
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
                  <div className="bc-panel-header">◇ Final Approach Parameters</div>
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
                  <InputRow
                    label="Acceleration"
                    value={faAccel}
                    onChange={setFaAccel}
                    unit={faAccelUnit}
                    units={['g', 'm/s²']}
                    onUnitChange={setFaAccelUnit}
                    placeholder="e.g. 1.95"
                  />
                  <div className="bc-panel-header" style={{ marginTop: 20 }}>◇ Reactant Budget</div>
                  <InputRow
                    label="Budget"
                    value={faBudget}
                    onChange={setFaBudget}
                    unit={faBudgetUnit}
                    units={['hr', 'min']}
                    onUnitChange={setFaBudgetUnit}
                    placeholder="Optional"
                  />
                  <InputRow
                    label={noWakeEnabled ? 'Tgt Vel at 300km' : `Tgt Vel at ${standoffKm || '?'}km`}
                    value={faVArrival}
                    onChange={setFaVArrival}
                    unit={faVArrivalUnit}
                    units={['m/s', 'km/s']}
                    onUnitChange={setFaVArrivalUnit}
                    placeholder="e.g. 0"
                  />
                  {/* NO-WAKE ZONE TOGGLE */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 118, marginBottom: 8 }}>
                    <button
                      className={`bc-unit-btn${noWakeEnabled ? ' active' : ''}`}
                      onClick={() => setNoWakeEnabled(true)}
                    >300KM ZONE ON</button>
                    <button
                      className={`bc-unit-btn${!noWakeEnabled ? ' active' : ''}`}
                      onClick={() => setNoWakeEnabled(false)}
                      style={!noWakeEnabled ? { color: 'var(--cyan)', borderColor: 'var(--cyan)', background: 'rgba(77,208,255,0.12)' } : {}}
                    >300KM ZONE OFF</button>
                  </div>
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
                  <div className="bc-field-note" style={{ marginBottom: 4, paddingLeft: 118 }}>
                    {noWakeEnabled
                      ? <span>300 KM NO-WAKE ZONE SUBTRACTED FROM RANGE</span>
                      : <span style={{ color: 'var(--cyan)' }}>{`◈ STAND-OFF: ${standoffKm || '?'} KM SUBTRACTED FROM RANGE`}</span>}
                  </div>

                  {/* FA GAME TIME */}
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

              {!plan.error && !plan.overshoot && (
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
                      <div className="bc-timeline-tick key" style={{ left: `${accelPct + rotPct + driftPct}%` }}>⬛ BRAKE</div>
                    )}
                    {!isDriftMode && t_accel > 0 && rotPct >= 10 && (
                      <div className="bc-timeline-tick key" style={{ left: `${accelPct + rotPct}%` }}>⬛ BRAKE</div>
                    )}
                    {!isDriftMode && t_accel > 0 && rotPct < 10 && (
                      <div className="bc-timeline-tick key" style={{ left: `${accelPct + rotPct / 2}%` }}>↺→⬛ FLIP</div>
                    )}
                    {t_accel === 0 && (
                      <div className="bc-timeline-tick key" style={{ left: `${rotPct}%` }}>⬛ BRAKE</div>
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
                  label={planValid ? (isDriftMode ? '⬛ End Drift / Brake' : '⬛ Begin Brake') : '⬛ Begin Brake'}
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
                  <img className="bc-tooltip-img" src={tooltip.img} alt={label} />
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