import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, Clock } from 'lucide-react';

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
  if (v0_mps < 0) return { error: 'CURRENT VELOCITY CANNOT BE NEGATIVE', detail: 'Enter zero or a positive closing speed.' };
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
  animation: bc-pulse-slow 2s ease-in-out infinite;
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
const TOOLTIP_IMG_CURRENTVEL = "data:image/png;base64,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";
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

  const [distance, setDistance] = useState('');
  const [distanceUnit, setDistanceUnit] = useState('km');
  const [v0, setV0] = useState('');
  const [v0Unit, setV0Unit] = useState('m/s');
  const [accel, setAccel] = useState('');
  const [accelUnit, setAccelUnit] = useState('g');
  const [flipTime, setFlipTime] = useState('');
  const [vArrival, setVArrival] = useState('');
  const [vArrivalUnit, setVArrivalUnit] = useState('m/s');
  const [vcrs, setVcrs] = useState('');
  const [vcrsUnit, setVcrsUnit] = useState('m/s');

  const [gameStartTime, setGameStartTime] = useState('');

  // ── flicker state (feature 11) ──
  const [flickerKey, setFlickerKey] = useState(0);
  const prevPlanRef = useRef(null);

  // SI conversions
  const NO_WAKE_M = 300_000; // 300 km no-wake zone at destination
  const distance_m = parseFloat(distance) * (distanceUnit === 'au' ? AU : distanceUnit === 'km' ? 1000 : 1);
  const raw_burn_distance_m = distance_m - NO_WAKE_M; // before VCRS correction
  const v0_mps = parseFloat(v0) * (v0Unit === 'km/s' ? 1000 : 1);
  const a_mps2 = parseFloat(accel) * (accelUnit === 'g' ? G : 1);
  const t_rotate_s = parseFloat(flipTime);
  const v_arrival_mps = parseFloat(vArrival) * (vArrivalUnit === 'km/s' ? 1000 : 1);
  const vcrs_mps = vcrs.trim() !== '' ? parseFloat(vcrs) * (vcrsUnit === 'km/s' ? 1000 : 1) : 0;

  // VCRS advisory threshold
  const vcrsRatioPct = (isFinite(vcrs_mps) && vcrs_mps > 0 && isFinite(v0_mps) && v0_mps > 0)
    ? (vcrs_mps / v0_mps) * 100
    : 0;
  const highVcrsWarning = vcrsRatioPct > 10;

  // Surface a clean error if the destination is within the no-wake zone
  const noWakeError = isFinite(distance_m) && distance_m <= NO_WAKE_M;

  // VCRS geometry correction (one-iteration approach):
  // Pass 1 — solve with straight-line burn distance to get approximate t_total
  const plan1 = noWakeError
    ? { error: 'DISTANCE WITHIN NO-WAKE ZONE' }
    : computePlan({ distance_m: raw_burn_distance_m, v0_mps, a_mps2, v_arrival_mps, t_rotate_s });

  // Compute cross-track drift over the burn duration, correct the true distance
  const t_total_approx = plan1.t_total || 0;
  const cross_drift_m = vcrs_mps * t_total_approx;
  const burn_distance_m = (vcrs_mps > 0 && t_total_approx > 0)
    ? Math.sqrt(raw_burn_distance_m ** 2 + cross_drift_m ** 2)
    : raw_burn_distance_m;
  const vcrs_correction_m = burn_distance_m - raw_burn_distance_m;

  // Pass 2 — recompute with corrected distance
  const plan = noWakeError
    ? { error: 'DISTANCE WITHIN NO-WAKE ZONE' }
    : (vcrs_mps > 0 && t_total_approx > 0)
      ? computePlan({ distance_m: burn_distance_m, v0_mps, a_mps2, v_arrival_mps, t_rotate_s })
      : plan1;

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

  const t_accel = plan.t_accel || 0;
  const t_rot = plan.t_rotate || 0;
  const t_total = plan.t_total || 0;
  const t_brake_start = t_accel + t_rot;

  const rotateTarget = gameTimeValid && !plan.error && !plan.overshoot
    ? addGameTime(parsedGameTime, t_accel) : null;
  const brakeTarget = gameTimeValid && !plan.error && !plan.overshoot
    ? addGameTime(parsedGameTime, t_brake_start) : null;
  const arriveTarget = gameTimeValid && !plan.error && !plan.overshoot
    ? addGameTime(parsedGameTime, t_total) : null;

  const accelPct = t_total ? (t_accel / t_total) * 100 : 0;
  const rotPct = t_total ? (t_rot / t_total) * 100 : 0;
  const brakePct = t_total ? (plan.t_brake / t_total) * 100 : 0;

  const planValid = !plan.error && !plan.overshoot && t_total > 0;
  const statusText = plan.error ? 'INVALID' : plan.overshoot ? 'OVERSHOOT' : planValid ? 'READY' : 'STANDBY';

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
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span className="bc-status-wrap">
                <span className={`bc-status-light ${plan.error || noWakeError ? 'invalid' : plan.overshoot ? 'overshoot' : 'ready'}`}></span>
                {gameTimeValid && planValid && <span className="bc-status-light clock" title="Game clock locked"></span>}
              </span>
              <span className="bc-status-text">{statusText}</span>
            </div>
          </div>

          <div className="bc-grid">
            {/* INPUTS */}
            <div className="bc-panel scratch-a">
              <div className="bc-panel-header">◇ Trip Parameters</div>

              <InputRow
                label="Current RNG"
                value={distance}
                onChange={setDistance}
                unit={distanceUnit}
                units={['km', 'm', 'au']}
                onUnitChange={setDistanceUnit}
                placeholder="e.g. 18902"
                tooltip={{
                  desc: "After selecting your target destination, input the distance to target.",
                  img: TOOLTIP_IMG_VCRS,
                }}
              />
              <div style={{ fontSize: 9, color: noWakeError ? 'var(--red)' : 'var(--text-secondary)', letterSpacing: '0.1em', marginBottom: 10, paddingLeft: 118 }}>
                {noWakeError
                  ? '⚠ DESTINATION IS WITHIN THE 300 KM NO-WAKE ZONE'
                  : isFinite(burn_distance_m)
                    ? `BURN DISTANCE: ${formatDistance(burn_distance_m)}${vcrs_correction_m > 0 ? ` (VCRS +${formatDistance(vcrs_correction_m)})` : ' (−300 KM NO-WAKE ZONE)'}`
                    : 'BURN DISTANCE: —'}
              </div>
              <InputRow
                label="Current VREL"
                value={v0}
                onChange={setV0}
                unit={v0Unit}
                units={['m/s', 'km/s']}
                onUnitChange={setV0Unit}
                placeholder="e.g. 511.19"
                tooltip={{
                  desc: "Input your vessel's current velocity while at a bearing of 0.00 degrees to the destination.",
                  img: TOOLTIP_IMG_CURRENTVEL,
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
              <InputRow
                label="Vel at 300km"
                value={vArrival}
                onChange={setVArrival}
                unit={vArrivalUnit}
                units={['m/s', 'km/s']}
                onUnitChange={setVArrivalUnit}
                placeholder="e.g. 0"
              />
              <div style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.1em', marginBottom: 4, paddingLeft: 118 }}>
                DESIRED SPEED AT TORCH DRIVE CUTOFF
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
              <div style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.1em', marginTop: 6, paddingLeft: 118 }}>
                {gameTimeError ? (
                  <span style={{ color: 'var(--red)' }}>INVALID FORMAT — USE YYYY-MM-DD HH:MM:SS OR HH:MM:SS</span>
                ) : gameTimeValid ? (
                  <span style={{ color: 'var(--green)' }}>● TARGETS COMPUTED FROM GAME CLOCK</span>
                ) : (
                  <span>LEAVE BLANK FOR RELATIVE (T+) TIMES — DATE OPTIONAL</span>
                )}
              </div>

            </div>

            {/* RESULTS */}
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
                    Ship is moving too fast to stop before the no-wake boundary.<br />
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
                <div className="bc-advisory">
                  <strong>HIGH VCRS DETECTED</strong> — Cross-track velocity is {vcrsRatioPct.toFixed(1)}% of closing velocity. RCS correction will not be sufficient at this magnitude. Recommend nulling VCRS with torch drive before starting burn, then re-enter updated values.
                </div>
              )}

              {!plan.error && !plan.overshoot && (
                <>
                  <Readout label="Peak Velocity" value={formatVelocity(plan.v_max)} highlight flickerKey={flickerKey} />
                  <Readout
                    label="Begin Rotate"
                    value={gameTimeValid ? formatGameTime(rotateTarget) : `T+${formatTime(plan.t_accel)}`}
                    highlight flickerKey={flickerKey}
                  />
                  <Readout
                    label="Begin Brake"
                    value={gameTimeValid ? formatGameTime(brakeTarget) : `T+${formatTime(t_brake_start)}`}
                    highlight flickerKey={flickerKey}
                  />
                  <Readout
                    label="Arrival"
                    value={gameTimeValid ? formatGameTime(arriveTarget) : `T+${formatTime(plan.t_total)}`}
                    highlight flickerKey={flickerKey}
                  />
                  <Readout label="Dist at Rotate" value={formatDistance(plan.d_accel)} dim flickerKey={flickerKey} />
                  <Readout label="Dist During Rotate" value={formatDistance(plan.d_coast)} dim flickerKey={flickerKey} />
                  <Readout
                    label="Brake Duration"
                    value={formatTime(Math.floor(plan.t_total) - Math.floor(t_brake_start))}
                    dim flickerKey={flickerKey}
                  />
                  {vcrs_correction_m >= burn_distance_m * 0.001 && (
                    <div className="bc-info" style={{ marginTop: 10 }}>
                      <strong>CROSS-TRACK CORRECTION APPLIED</strong> — burn distance extended by {formatDistance(vcrs_correction_m)} due to VCRS drift over burn duration.
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* TIMELINE + GAME-TIME TARGETS */}
          {planValid && (
            <div className="bc-panel bc-timeline-panel scratch-c">
              <div className="bc-panel-header">◇ Burn Timeline</div>

              <div className="bc-timeline">
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
                <div className="bc-timeline-phase brake" style={{ left: `${accelPct + rotPct}%`, width: `${brakePct}%` }}>
                  {brakePct > 8 ? 'BRAKE' : ''}
                </div>

                <div className="bc-timeline-tick" style={{ left: 0 }}>T+0</div>
                {t_accel > 0 && rotPct >= 10 && (
                  <div className="bc-timeline-tick key" style={{ left: `${accelPct}%` }}>↺ ROTATE</div>
                )}
                {t_accel > 0 && rotPct >= 10 && (
                  <div className="bc-timeline-tick key" style={{ left: `${accelPct + rotPct}%` }}>⬛ BRAKE</div>
                )}
                {t_accel > 0 && rotPct < 10 && (
                  <div className="bc-timeline-tick key" style={{ left: `${accelPct + rotPct / 2}%` }}>↺→⬛ FLIP</div>
                )}
                {t_accel === 0 && (
                  <div className="bc-timeline-tick key" style={{ left: `${rotPct}%` }}>⬛ BRAKE</div>
                )}
                <div className="bc-timeline-tick" style={{ left: '100%' }}>◉ ARRIVE</div>
              </div>

              <div className="bc-targets-grid">
                <TargetCell
                  variant="rotate"
                  label="↺ Begin Rotate"
                  gameTime={rotateTarget}
                  relative={`T+${formatTime(plan.t_accel)}`}
                />
                <TargetCell
                  variant="brake"
                  label="⬛ Begin Brake"
                  gameTime={brakeTarget}
                  relative={`T+${formatTime(t_brake_start)}`}
                />
                <TargetCell
                  variant="arrive"
                  label="◉ Arrival"
                  gameTime={arriveTarget}
                  relative={`T+${formatTime(plan.t_total)}`}
                />
              </div>

              {!gameTimeValid && (
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