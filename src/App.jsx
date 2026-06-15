import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, Clock } from 'lucide-react';
import './styles.css';
import {
  G,
  AU,
  DAY,
  NO_WAKE_M,
  EFFICIENCY_TIME_MULTIPLIER,
  parseNum,
  parseGValue,
  formatTime,
  formatDistance,
  formatVelocity,
  parseGameTime,
  daysInMonth,
  addGameTime,
  formatGameTime,
  computePlan,
  computeFinalApproach,
  parseTargetDuration,
  formatTargetDuration,
  solveAcceleration,
} from './physics.js';

const APP_VERSION = 'v0.5.4';

// Embedded screenshot data for tooltips
const TOOLTIP_IMG_DISTANCE = `${import.meta.env.BASE_URL}tooltips/distance.jpg`;
const TOOLTIP_IMG_CURRENTVEL = `${import.meta.env.BASE_URL}tooltips/current-vel.jpg`;
const TOOLTIP_IMG_VCRS = `${import.meta.env.BASE_URL}tooltips/vcrs.jpg`;
const TOOLTIP_IMG_REACTANTBUDGET = `${import.meta.env.BASE_URL}tooltips/reactantbudget.jpg`;
const TOOLTIP_IMG_ACCELERATION = `${import.meta.env.BASE_URL}tooltips/acceleration.jpg`;

// ───── persistence helpers ─────────────────────────────────────────────────
// URL params take precedence over localStorage; per-burn readings are URL-only.

function _up(key) {
  try {
    return new URLSearchParams(window.location.search).get(key);
  } catch {
    return null;
  }
}
function _ls(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function _lsSave(key, value) {
  try {
    if (value !== null && value !== undefined) localStorage.setItem(key, String(value));
    else localStorage.removeItem(key);
  } catch {}
}
/** Read from URL, then localStorage, then fall back to default. */
function _ul(urlKey, lsKey, fallback) {
  const v = _up(urlKey);
  return v !== null ? v : (_ls(lsKey) ?? fallback);
}

// ───── StandoffControl subcomponent ────────────────────────────────────────
// Renders the No-Wake toggle, stand-off distance input, and the field note.
// Shared between Burn Plan and Final Approach to avoid duplicating this block.

function NoWakeToggle({ noWakeEnabled, setNoWakeEnabled }) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 118, marginBottom: 8 }}
    >
      <button
        className={`bc-unit-btn${!noWakeEnabled ? ' active' : ''}`}
        onClick={() => setNoWakeEnabled(false)}
      >
        OPEN SPACE
      </button>
      <button
        className={`bc-unit-btn${noWakeEnabled ? ' active' : ''}`}
        onClick={() => setNoWakeEnabled(true)}
        style={
          noWakeEnabled
            ? {
                color: 'var(--cyan)',
                borderColor: 'var(--cyan)',
                background: 'rgba(77,208,255,0.12)',
              }
            : {}
        }
      >
        NO-WAKE ZONE
      </button>
    </div>
  );
}

function StandoffControl({ noWakeEnabled, setNoWakeEnabled, standoffKm, setStandoffKm }) {
  return (
    <>
      {/* STAND-OFF DISTANCE — locked at 300 when NO-WAKE ZONE, editable in OPEN SPACE */}
      <div className="bc-input-row">
        <div className="bc-label">Stand-off</div>
        <input
          className="bc-input"
          type="text"
          inputMode="decimal"
          value={noWakeEnabled ? '300km' : standoffKm}
          placeholder="e.g. 2.5km"
          disabled={noWakeEnabled}
          onChange={(e) => !noWakeEnabled && setStandoffKm(e.target.value)}
        />
      </div>
      <NoWakeToggle noWakeEnabled={noWakeEnabled} setNoWakeEnabled={setNoWakeEnabled} />
    </>
  );
}

// ───── error boundary ──────────────────────────────────────────────────

class ErrorBoundary extends React.Component {
  state = { err: null };
  static getDerivedStateFromError(err) {
    return { err };
  }
  render() {
    if (this.state.err) {
      return (
        <div
          style={{
            padding: 24,
            fontFamily: "'IBM Plex Mono', monospace",
            color: '#ff5d5d',
            letterSpacing: '0.1em',
            background: '#1a1d20',
            minHeight: '100vh',
          }}
        >
          ⚠ GUIDANCE COMPUTER FAULT
          <br />
          <br />
          {String(this.state.err?.message || this.state.err)}
          <br />
          <br />
          Reload to restart the nav subsystem.
        </div>
      );
    }
    return this.props.children;
  }
}

export default function BurnCalculator() {
  return (
    <ErrorBoundary>
      <BurnCalculatorInner />
    </ErrorBoundary>
  );
}

function BurnCalculatorInner() {
  // ── boot sequence state ──
  const [booting, setBooting] = useState(() => {
    try {
      return !sessionStorage.getItem('pa_booted');
    } catch {
      return false;
    }
  });
  const [bootFade, setBootFade] = useState(false);
  const [visibleLines, setVisibleLines] = useState([]);

  useEffect(() => {
    if (!booting) return;
    try {
      sessionStorage.setItem('pa_booted', '1');
    } catch {
      /* restricted context — skip */
    }
    const timers = [];
    const lineDelays = [0, 300, 600, 1100, 1700, 2300, 2900, 3500, 4100, 5200];
    lineDelays.forEach((delay, i) => {
      timers.push(setTimeout(() => setVisibleLines((prev) => [...prev, i]), delay));
    });
    timers.push(setTimeout(() => setBootFade(true), 7000));
    timers.push(setTimeout(() => setBooting(false), 8000));
    return () => timers.forEach(clearTimeout);
  }, [booting]); // booting only true on first mount; guard above makes subsequent runs no-ops

  // appMode: read from URL hash (#burn / #approach)
  const [appMode, setAppMode] = useState(() => {
    try {
      return window.location.hash.replace('#', '') === 'approach' ? 'approach' : 'burn';
    } catch {
      return 'burn';
    }
  });

  // ── Final Approach state — per-burn fields from URL only, vessel/prefs from URL→LS ──
  const [faDistance, setFaDistance] = useState(() => _up('fad') ?? '');
  const [faDistanceUnit, setFaDistanceUnit] = useState(() => _ul('fadu', 'pa_fadu', 'km'));
  const [faVrel, setFaVrel] = useState(() => _up('fav') ?? '');
  const [faVrelUnit, setFaVrelUnit] = useState(() => _ul('favu', 'pa_favu', 'm/s'));
  const [faAccel, setFaAccel] = useState(() => _ul('faa', 'pa_fa_accel', ''));
  const [faBudget, setFaBudget] = useState(() => _up('fab') ?? '');
  const [faVArrival, setFaVArrival] = useState(() => _up('fava') ?? '0');
  const [faVArrivalUnit, setFaVArrivalUnit] = useState(() => _ul('fvau', 'pa_fvau', 'm/s'));
  const [faGameStart, setFaGameStart] = useState(() => _up('fgt') ?? '');

  // Burn Plan state — per-burn fields from URL only, vessel/prefs from URL→LS
  const [distance, setDistance] = useState(() => _up('d') ?? '');
  const [distanceUnit, setDistanceUnit] = useState(() => _ul('du', 'pa_du', 'km'));
  const [v0, setV0] = useState(() => _up('v') ?? '');
  const [v0Unit, setV0Unit] = useState(() => _ul('vu', 'pa_vu', 'm/s'));
  const [v0Direction, setV0Direction] = useState(() => _up('vd') ?? 'closing');
  const [accel, setAccel] = useState(() => _ul('a', 'pa_accel', ''));
  const [flipTime, setFlipTime] = useState(() => _ul('f', 'pa_flip_time', '60'));
  const [reactantBudget, setReactantBudget] = useState(() => _up('b') ?? '');
  const [burnPreference, setBurnPreference] = useState(() => _ul('bp', 'pa_burn_pref', 'speed'));
  const [vArrival, setVArrival] = useState(() => _up('va') ?? '0');
  const [vArrivalUnit, setVArrivalUnit] = useState(() => _ul('vau', 'pa_vau', 'm/s'));
  const [vcrs, setVcrs] = useState(() => _up('cx') ?? '');
  const [vcrsUnit, setVcrsUnit] = useState(() => _up('cu') ?? 'm/s');
  const [noWakeEnabled, setNoWakeEnabled] = useState(() => {
    const u = _up('nw');
    if (u !== null) return u !== '0';
    const l = _ls('pa_no_wake');
    return l !== null ? l !== '0' : true;
  });
  const [standoffKm, setStandoffKm] = useState(() => _ul('sk', 'pa_standoff_km', '2.5'));
  const [targetDuration, setTargetDuration] = useState(() => _up('td') ?? '');
  const [gameStartTime, setGameStartTime] = useState(() => _up('gt') ?? '');

  // ── flicker state (feature 11) ──
  const [flickerKey, setFlickerKey] = useState(0);
  const prevPlanRef = useRef(null);

  // ── URL state sync — update address bar whenever any input changes ──────
  useEffect(() => {
    const p = new URLSearchParams();
    if (distance) p.set('d', distance);
    if (distanceUnit !== 'km') p.set('du', distanceUnit);
    if (v0) p.set('v', v0);
    if (v0Unit !== 'm/s') p.set('vu', v0Unit);
    if (v0Direction !== 'closing') p.set('vd', v0Direction);
    if (accel) p.set('a', accel);
    if (flipTime !== '60') p.set('f', flipTime);
    if (reactantBudget) p.set('b', reactantBudget);
    if (vArrival !== '0') p.set('va', vArrival);
    if (vArrivalUnit !== 'm/s') p.set('vau', vArrivalUnit);
    if (vcrs) p.set('cx', vcrs);
    if (vcrsUnit !== 'm/s') p.set('cu', vcrsUnit);
    p.set('nw', noWakeEnabled ? '1' : '0');
    if (standoffKm !== '2.5') p.set('sk', standoffKm);
    if (targetDuration) p.set('td', targetDuration);
    if (burnPreference !== 'speed') p.set('bp', burnPreference);
    if (gameStartTime) p.set('gt', gameStartTime);
    if (faDistance) p.set('fad', faDistance);
    if (faDistanceUnit !== 'km') p.set('fadu', faDistanceUnit);
    if (faVrel) p.set('fav', faVrel);
    if (faVrelUnit !== 'm/s') p.set('favu', faVrelUnit);
    if (faAccel) p.set('faa', faAccel);
    if (faBudget) p.set('fab', faBudget);
    if (faVArrival !== '0') p.set('fava', faVArrival);
    if (faVArrivalUnit !== 'm/s') p.set('fvau', faVArrivalUnit);
    if (faGameStart) p.set('fgt', faGameStart);
    const qs = p.toString();
    try {
      history.replaceState(
        null,
        '',
        `${window.location.pathname}${qs ? '?' + qs : ''}#${appMode}`
      );
    } catch {}
  }, [
    distance, distanceUnit, v0, v0Unit, v0Direction, accel, flipTime, reactantBudget,
    vArrival, vArrivalUnit, vcrs, vcrsUnit, noWakeEnabled, standoffKm, targetDuration,
    burnPreference, gameStartTime, faDistance, faDistanceUnit, faVrel, faVrelUnit,
    faAccel, faBudget, faVArrival, faVArrivalUnit, faGameStart, appMode,
  ]);

  // ── localStorage sync — vessel params and preferences only ───────────────
  useEffect(() => {
    _lsSave('pa_accel', accel || null);
    _lsSave('pa_fa_accel', faAccel || null);
    _lsSave('pa_flip_time', flipTime !== '60' ? flipTime : null);
    _lsSave('pa_burn_pref', burnPreference !== 'speed' ? burnPreference : null);
    _lsSave('pa_no_wake', noWakeEnabled ? '1' : '0');
    _lsSave('pa_standoff_km', standoffKm !== '2.5' ? standoffKm : null);
    _lsSave('pa_du', distanceUnit !== 'km' ? distanceUnit : null);
    _lsSave('pa_vu', v0Unit !== 'm/s' ? v0Unit : null);
    _lsSave('pa_vau', vArrivalUnit !== 'm/s' ? vArrivalUnit : null);
    _lsSave('pa_fadu', faDistanceUnit !== 'km' ? faDistanceUnit : null);
    _lsSave('pa_favu', faVrelUnit !== 'm/s' ? faVrelUnit : null);
    _lsSave('pa_fvau', faVArrivalUnit !== 'm/s' ? faVArrivalUnit : null);
  }, [
    accel, faAccel, flipTime, burnPreference, noWakeEnabled, standoffKm,
    distanceUnit, v0Unit, vArrivalUnit, faDistanceUnit, faVrelUnit, faVArrivalUnit,
  ]);

  // ── mode switch — copies shared fields (range, vrel) on transition ────────
  function switchMode(newMode) {
    if (newMode === 'approach' && appMode === 'burn') {
      if (!faDistance && distance) {
        setFaDistance(distance);
        setFaDistanceUnit(distanceUnit);
      }
      if (!faVrel && v0) {
        setFaVrel(v0);
        setFaVrelUnit(v0Unit);
      }
    } else if (newMode === 'burn' && appMode === 'approach') {
      if (!distance && faDistance) {
        setDistance(faDistance);
        setDistanceUnit(faDistanceUnit);
      }
      if (!v0 && faVrel) {
        setV0(faVrel);
        setV0Unit(faVrelUnit);
      }
    }
    setAppMode(newMode);
  }

  // ── copy-to-clipboard state ──────────────────────────────────────────────
  const [copied, setCopied] = useState(false);

  function handleBurnCopy() {
    const lines = [];
    if (solveForAccel && accelSolveResult && !accelSolveResult.error) {
      lines.push(`Computed Accel: ${(accelSolveResult.a_mps2 / G).toFixed(2)} G`);
    }
    lines.push(
      `${isDriftMode ? 'End Accel / Begin Flip' : 'Begin Rotate'}: ${gameTimeValid ? formatGameTime(rotateTarget) : 'T+' + formatTime(t_accel)}`
    );
    if (isDriftMode) {
      lines.push(
        `End Drift / Begin Brake: ${gameTimeValid ? formatGameTime(driftEndTarget) : 'T+' + formatTime(t_brake_start)}`
      );
    } else {
      lines.push(
        `Begin Brake: ${gameTimeValid ? formatGameTime(brakeTarget) : 'T+' + formatTime(t_brake_start)}`
      );
    }
    lines.push(
      `Arrival: ${gameTimeValid ? formatGameTime(arriveTarget) : 'T+' + formatTime(t_total)}`
    );
    lines.push(`Accel Duration: ${formatTime(Math.floor(t_accel))}`);
    if (isDriftMode) lines.push(`Drift Duration: ${formatTime(Math.floor(finalPlan.t_drift || 0))}`);
    lines.push(`Brake Duration: ${formatTime(Math.floor(t_total) - Math.floor(t_brake_start))}`);
    lines.push(`Accel Distance: ${formatDistance(finalPlan.d_accel)}`);
    if (isDriftMode) lines.push(`Drift Distance: ${formatDistance(finalPlan.d_drift)}`);
    lines.push(`Brake Distance: ${formatDistance(finalPlan.d_brake)}`);
    lines.push(`Total Distance: ${formatDistance(burn_distance_m)}`);
    lines.push(`Peak Velocity: ${formatVelocity(finalPlan.v_max)}`);
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleFaCopy() {
    const lines = [];
    if (faPlan.t_coast > 1) {
      lines.push(
        `Begin Brake: ${faGameTimeValid ? formatGameTime(faBrakeTarget) : 'T+' + formatTime(Math.floor(faPlan.t_coast))}`
      );
    }
    lines.push(
      `Arrival: ${faGameTimeValid ? formatGameTime(faArriveTarget) : 'T+' + formatTime(Math.floor(faPlan.t_total))}`
    );
    lines.push(`Brake Duration: ${formatTime(Math.floor(faPlan.t_brake))}`);
    lines.push(`Brake Distance: ${formatDistance(faPlan.d_brake)}`);
    if (faPlan.d_coast > 0) lines.push(`Coast Distance: ${formatDistance(faPlan.d_coast)}`);
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // SI conversions
  const standoff_m = noWakeEnabled ? NO_WAKE_M : parseNum(standoffKm) * 1000 || 0;
  const standoffValid =
    noWakeEnabled || (isFinite(parseNum(standoffKm)) && parseNum(standoffKm) > 0);
  const distance_m =
    parseNum(distance) *
    (distanceUnit === 'au' ? AU : distanceUnit === 'gm' ? 1e9 : distanceUnit === 'km' ? 1000 : 1);
  const raw_burn_distance_m = distance_m - standoff_m; // before VCRS correction
  const v0_mps =
    parseNum(v0) * (v0Unit === 'km/s' ? 1000 : 1) * (v0Direction === 'receding' ? -1 : 1);
  const t_rotate_s_parsed = parseTargetDuration(flipTime);
  const t_rotate_s = t_rotate_s_parsed !== null ? t_rotate_s_parsed : parseNum(flipTime) || 0;
  const flipTimeAttempted = flipTime.trim().length > 0;
  const flipTimeValid = t_rotate_s_parsed !== null;
  const flipTimeError = flipTimeAttempted && !flipTimeValid;
  const v_arrival_mps = parseNum(vArrival) * (vArrivalUnit === 'km/s' ? 1000 : 1);
  const vcrs_mps = vcrs.trim() !== '' ? parseNum(vcrs) * (vcrsUnit === 'km/s' ? 1000 : 1) : 0;

  // ── Desired Travel Time: parse input ──
  const targetDurationAttempted = targetDuration.trim().length > 0;
  const targetDuration_s = parseTargetDuration(targetDuration);
  const targetDurationValid = targetDuration_s !== null;
  const targetDurationError = targetDurationAttempted && !targetDurationValid;

  // ── Implicit solve direction detection ──
  // accel blank, time filled  → solve for acceleration
  // time blank, accel filled  → solve for time (standard)
  // both filled               → validate consistency
  // both blank                → no output
  const accelFilled = accel.trim() !== '';
  const timeFilled = targetDurationAttempted && targetDurationValid;
  const solveForAccel = !accelFilled && timeFilled;
  const solveForTime = accelFilled && !targetDurationAttempted;
  const validateBoth = accelFilled && timeFilled;

  // Surface a clean error if the destination is within the stand-off zone
  const standoffError = !standoffValid
    ? 'invalid-standoff'
    : isFinite(distance_m) && distance_m <= standoff_m
      ? 'within-standoff'
      : null;
  const noWakeError = standoffError !== null; // keeps downstream compat

  // Derive a_mps2: from solver when solving for accel, from input otherwise.
  // Must be after noWakeError since the solver is gated on it.
  const accelSolveResult =
    solveForAccel && !noWakeError
      ? solveAcceleration({
          distance_m: raw_burn_distance_m,
          v0_mps,
          v_arrival_mps,
          t_rotate_s,
          t_total_s: targetDuration_s,
        })
      : null;
  const a_mps2 = solveForAccel
    ? accelSolveResult && !accelSolveResult.error
      ? accelSolveResult.a_mps2
      : NaN
    : (() => {
        const v = parseGValue(accel);
        return isFinite(v) && v < 0.01 * G ? NaN : v;
      })();

  // VCRS geometry correction (one-iteration approach):
  // Pass 1 — solve with straight-line burn distance to get approximate t_total
  const standoffBlockMsg =
    standoffError === 'invalid-standoff'
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
  const burn_distance_m =
    vcrs_mps !== 0 && t_total_approx > 0
      ? Math.sqrt(raw_burn_distance_m ** 2 + cross_drift_m ** 2)
      : raw_burn_distance_m;
  const vcrs_correction_m = burn_distance_m - raw_burn_distance_m;

  // Pass 2 — recompute with corrected distance
  const plan = noWakeError
    ? { error: standoffBlockMsg }
    : vcrs_mps !== 0 && t_total_approx > 0
      ? computePlan({ distance_m: burn_distance_m, v0_mps, a_mps2, v_arrival_mps, t_rotate_s })
      : plan1;

  // Reactant budget conversion — parsed same as Desired Travel Time (bare number = seconds)
  const budget_s = (() => {
    const parsed = parseTargetDuration(reactantBudget);
    return parsed !== null && parsed > 0 ? parsed : null;
  })();

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

  let driftPlan = null; // budget-constrained drift (budget < requirement)
  let efficiencyPlan = null; // 2×-time efficiency drift (budget > requirement)
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
      const P = v0_mps + v_arrival_mps + a_mps2 * T_target;
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
      else {
        budgetExceedsReq = true;
      } // distance too short even here → treat as exceeds
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
  const vcrsRatioPct =
    isFinite(vcrs_mps) && vcrs_mps !== 0 && isFinite(v0_mps) && v0_mps !== 0
      ? (Math.abs(vcrs_mps) / Math.abs(v0_mps)) * 100
      : 0;
  const highVcrsWarning = Math.abs(vcrs_mps) > 500;

  // Manual null heading + null time for high VCRS warning
  const vcrsNullTime =
    highVcrsWarning && isFinite(vcrs_mps) && isFinite(a_mps2) && a_mps2 > 0
      ? Math.abs(vcrs_mps) / a_mps2
      : null;

  const manualNullBearing =
    highVcrsWarning && isFinite(vcrs_mps) ? (vcrs_mps >= 0 ? '90.00°' : '270.00°') : null;

  // ── Final Approach calculations ──
  const fa_distance_m_raw =
    parseNum(faDistance) * (faDistanceUnit === 'au' ? AU : faDistanceUnit === 'gm' ? 1e9 : 1000);
  const fa_brake_distance_m = isFinite(fa_distance_m_raw) ? fa_distance_m_raw - standoff_m : NaN;
  const fa_v0_mps = parseNum(faVrel) * (faVrelUnit === 'km/s' ? 1000 : 1);
  const fa_v_arrival_mps = parseNum(faVArrival) * (faVArrivalUnit === 'km/s' ? 1000 : 1);

  // FA solve-for-accel: when acceleration field is blank, derive required_a from distance/velocities
  const faAccelBlank = faAccel.trim() === '';
  const fa_required_a_computed =
    faAccelBlank &&
    isFinite(fa_brake_distance_m) &&
    fa_brake_distance_m > 0 &&
    isFinite(fa_v0_mps) &&
    fa_v0_mps > 0 &&
    isFinite(fa_v_arrival_mps) &&
    fa_v_arrival_mps < fa_v0_mps
      ? (fa_v0_mps * fa_v0_mps - fa_v_arrival_mps * fa_v_arrival_mps) / (2 * fa_brake_distance_m)
      : null;
  // Reject computed acceleration below minimum viable thrust (0.01 G)
  const fa_required_a_belowMin =
    fa_required_a_computed !== null && fa_required_a_computed < 0.01 * G;
  // Operating acceleration: computed required_a when blank (and above floor), otherwise player input
  const fa_a_mps2 = faAccelBlank
    ? fa_required_a_computed !== null && !fa_required_a_belowMin
      ? fa_required_a_computed
      : NaN
    : (() => {
        const v = parseGValue(faAccel);
        return isFinite(v) && v < 0.01 * G ? NaN : v;
      })();

  // FA budget conversion — parsed same as Desired Travel Time (bare number = seconds)
  const fa_budget_s = (() => {
    const parsed = parseTargetDuration(faBudget);
    return parsed !== null && parsed > 0 ? parsed : null;
  })();

  // Stand-off error for FA (mirrors burn-mode logic)
  const fa_standoffError = !standoffValid
    ? 'invalid-standoff'
    : isFinite(fa_distance_m_raw) && fa_distance_m_raw <= standoff_m
      ? 'within-standoff'
      : null;
  const fa_noWakeError = fa_standoffError !== null;

  const faPlan =
    appMode === 'approach'
      ? fa_standoffError === 'invalid-standoff'
        ? { error: 'INVALID STAND-OFF DISTANCE', detail: 'Enter a positive distance in km.' }
        : fa_standoffError === 'within-standoff'
          ? noWakeEnabled
            ? {
                error: 'DESTINATION IS WITHIN THE 300 KM NO-WAKE ZONE',
                detail: 'You are already inside the no-wake boundary.',
              }
            : {
                error: `DESTINATION IS WITHIN THE STAND-OFF ZONE (${standoffKm} KM)`,
                detail: 'Increase total range or reduce the stand-off distance.',
              }
          : computeFinalApproach({
              distance_m: fa_brake_distance_m,
              v0_mps: fa_v0_mps,
              a_mps2: fa_a_mps2,
              v_arrival_mps: fa_v_arrival_mps,
            })
      : null;

  // Reactant sufficiency for FA at operating acceleration (full thrust or computed)
  const fa_reactant_ok =
    fa_budget_s !== null && faPlan && !faPlan.error && !faPlan.overshoot
      ? fa_budget_s >= faPlan.t_brake
      : null; // null = no budget entered, don't show

  // Throttled-G reactant check: when player has an available accel AND required_a < fa_a_mps2,
  // show a second line for what happens if they throttle down to required_a.
  // Not shown in constant-burn mode (faAccelBlank) since there's only one accel in play.
  const fa_throttled_brake_s =
    !faAccelBlank &&
    fa_budget_s !== null &&
    faPlan &&
    !faPlan.error &&
    !faPlan.overshoot &&
    isFinite(faPlan.required_a) &&
    isFinite(fa_a_mps2) &&
    faPlan.required_a < fa_a_mps2 - 1e-6
      ? (fa_v0_mps - fa_v_arrival_mps) / faPlan.required_a
      : null;
  const fa_throttled_ok =
    fa_throttled_brake_s !== null ? fa_budget_s >= fa_throttled_brake_s : null;

  // FA game clock
  const faParsedGameTime = parseGameTime(faGameStart);
  const faGameTimeValid = faParsedGameTime !== null;
  const faGameTimeAttempted = faGameStart.trim().length > 0;
  const faGameTimeError = faGameTimeAttempted && !faGameTimeValid;

  const faPlanOk = faPlan && !faPlan.error && !faPlan.overshoot;
  const faBrakeTarget =
    faGameTimeValid && faPlanOk ? addGameTime(faParsedGameTime, faPlan.t_coast) : null;
  const faArriveTarget =
    faGameTimeValid && faPlanOk ? addGameTime(faParsedGameTime, faPlan.t_total) : null;

  // Status for FA mode
  const faStatusText = !faPlan
    ? 'STANDBY'
    : faPlan.error
      ? 'INVALID'
      : faPlan.overshoot
        ? 'OVERSHOOT'
        : 'READY';

  // Flicker effect: trigger when plan output changes
  useEffect(() => {
    const key = JSON.stringify({
      v_max: plan.v_max,
      t_accel: plan.t_accel,
      t_total: plan.t_total,
      error: plan.error,
    });
    if (prevPlanRef.current !== null && prevPlanRef.current !== key) {
      setFlickerKey((k) => k + 1);
    }
    prevPlanRef.current = key;
  }, [plan.v_max, plan.t_accel, plan.t_total, plan.error]);

  // Game time parsing
  const parsedGameTime = parseGameTime(gameStartTime);
  const gameTimeValid = parsedGameTime !== null;
  const gameTimeAttempted = gameStartTime.trim().length > 0;
  const gameTimeError = gameTimeAttempted && !gameTimeValid;

  // Game clock time at end of VCRS null burn (needs gameTimeValid/parsedGameTime)
  const vcrsNullTarget =
    vcrsNullTime !== null && gameTimeValid ? addGameTime(parsedGameTime, vcrsNullTime) : null;

  const t_accel = finalPlan.t_accel || 0;
  const t_rot = finalPlan.t_rotate || 0;
  const t_drift = finalPlan.t_drift || 0;
  const t_total = finalPlan.t_total || 0;
  const t_flip_end = t_accel + t_rot;
  const t_brake_start = isDriftMode ? t_flip_end + t_drift : t_flip_end;

  const planOk = !finalPlan.error && !finalPlan.overshoot && !plan.error && !plan.overshoot;
  const rotateTarget = gameTimeValid && planOk ? addGameTime(parsedGameTime, t_accel) : null;
  const driftEndTarget =
    gameTimeValid && planOk && isDriftMode ? addGameTime(parsedGameTime, t_brake_start) : null;
  const brakeTarget = gameTimeValid && planOk ? addGameTime(parsedGameTime, t_brake_start) : null;
  const arriveTarget = gameTimeValid && planOk ? addGameTime(parsedGameTime, t_total) : null;

  const accelPct = t_total ? (t_accel / t_total) * 100 : 0;
  const rotPct = t_total ? (t_rot / t_total) * 100 : 0;
  const driftPct = t_total && isDriftMode ? (t_drift / t_total) * 100 : 0;
  const brakePct = t_total ? ((finalPlan.t_brake || 0) / t_total) * 100 : 0;

  const budgetInsufficient = !!(driftPlan && driftPlan.error);
  const planValid = !plan.error && !plan.overshoot && t_total > 0 && !budgetInsufficient;
  const statusText = budgetInsufficient
    ? 'INVALID'
    : plan.error
      ? 'INVALID'
      : plan.overshoot
        ? 'OVERSHOOT'
        : planValid
          ? 'READY'
          : 'STANDBY';

  // Combined status for header light — mode-aware
  const activeStatusText = appMode === 'approach' ? faStatusText : statusText;
  const activeHasError =
    appMode === 'approach'
      ? faPlan && (faPlan.error || fa_noWakeError)
      : plan.error || noWakeError || !!(driftPlan && driftPlan.error);
  const activeIsOvershoot = appMode === 'approach' ? faPlan && faPlan.overshoot : plan.overshoot;

  return (
    <>
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
              <div
                key={i}
                className={`bc-boot-line${cls ? ' ' + cls : ''}${visibleLines.includes(i) ? ' visible' : ''}`}
              >
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
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                  color: 'var(--text-dim)',
                  letterSpacing: '0.12em',
                }}
              >
                {APP_VERSION}
              </span>
              <span className="bc-status-wrap">
                <span
                  className={`bc-status-light ${activeHasError ? 'invalid' : activeIsOvershoot ? 'overshoot' : 'ready'}`}
                ></span>
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
                  onClick={() => switchMode('burn')}
                >
                  ◈ Burn Plan
                </button>
                <button
                  className={`bc-mode-btn${appMode === 'approach' ? ' active' : ''}`}
                  onClick={() => switchMode('approach')}
                >
                  ◉ Final Approach
                </button>
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
                    invalid={distance.trim() === ''}
                    inputMode="decimal"
                    tooltip={{
                      desc: 'After selecting your target destination, input the distance to target.',
                      img: TOOLTIP_IMG_DISTANCE,
                    }}
                  />
                  {noWakeError && (
                    <div
                      className="bc-field-note"
                      style={{ color: 'var(--red)', marginBottom: 10, paddingLeft: 118 }}
                    >
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
                    invalid={v0.trim() === ''}
                    inputMode="decimal"
                    tooltip={{
                      desc: "Input your vessel's current velocity to the target. If no ETA is present, set mode to RECEDING.",
                      img: TOOLTIP_IMG_CURRENTVEL,
                    }}
                  />
                  <div style={{ display: 'flex', gap: 4, marginLeft: 118, marginBottom: 8 }}>
                    <button
                      className={`bc-unit-btn${v0Direction === 'closing' ? ' active' : ''}`}
                      onClick={() => setV0Direction('closing')}
                    >
                      CLOSING
                    </button>
                    <button
                      className={`bc-unit-btn${v0Direction === 'receding' ? ' active' : ''}`}
                      onClick={() => setV0Direction('receding')}
                      style={{
                        color: v0Direction === 'receding' ? 'var(--red)' : undefined,
                        borderColor: v0Direction === 'receding' ? 'var(--red)' : undefined,
                        background: v0Direction === 'receding' ? 'rgba(255,93,93,0.15)' : undefined,
                      }}
                    >
                      RECEDING
                    </button>
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
                      desc: 'Input your VCRS to the target destination.',
                      img: TOOLTIP_IMG_VCRS,
                    }}
                  />

                  {/* ── Arrival Parameters ── */}
                  <div className="bc-panel-header" style={{ marginTop: 20 }}>
                    ◇ Arrival Parameters
                  </div>
                  <InputRow
                    label={noWakeEnabled ? 'Tgt Vel at 300km' : `Tgt Vel at ${standoffKm || '?'}km`}
                    value={vArrival}
                    onChange={setVArrival}
                    unit={vArrivalUnit}
                    units={['m/s', 'km/s']}
                    onUnitChange={setVArrivalUnit}
                    placeholder="e.g. 0"
                    inputMode="decimal"
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
                    units={[]}
                    placeholder="e.g. 3h 30m or 12600"
                    tooltip={{
                      desc: 'Enter the amount of reactant you plan to allocate to this burn. It is not recommended to commit all your available reactant.',
                      img: TOOLTIP_IMG_REACTANTBUDGET,
                    }}
                  />
                  {reactantBudget.trim().length > 0 && (
                    <div className="bc-field-note" style={{ marginBottom: 6, paddingLeft: 118 }}>
                      {budget_s !== null ? (
                        <span style={{ color: 'var(--green)' }}>
                          ● {formatTargetDuration(budget_s)}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--red)' }}>INVALID FORMAT</span>
                      )}
                    </div>
                  )}
                  {(isDriftMode && !budgetExceedsReqWithPlan) ||
                  budgetExceedsReqWithPlan ||
                  budgetExceedsReq ||
                  (driftPlan && driftPlan.error) ? (
                    <div className="bc-field-note" style={{ marginBottom: 4, paddingLeft: 118 }}>
                      {isDriftMode && !budgetExceedsReqWithPlan ? (
                        <span style={{ color: 'var(--amber)' }}>◈ DRIFT MODE ACTIVE</span>
                      ) : budgetExceedsReqWithPlan ? (
                        <span style={{ color: 'var(--green)' }}>
                          ● BUDGET EXCEEDS REQUIREMENT — SELECT PREFERENCE
                        </span>
                      ) : budgetExceedsReq ? (
                        <span style={{ color: 'var(--green)' }}>
                          ● BUDGET EXCEEDS REQUIREMENT — STANDARD BURN USED
                        </span>
                      ) : (
                        <span style={{ color: 'var(--red)' }}>{driftPlan.error}</span>
                      )}
                    </div>
                  ) : null}
                  {budgetExceedsReqWithPlan && (
                    <>
                      <div style={{ display: 'flex', gap: 4, marginLeft: 118, marginBottom: 4 }}>
                        <button
                          className={`bc-unit-btn${burnPreference === 'speed' ? ' active' : ''}`}
                          onClick={() => setBurnPreference('speed')}
                        >
                          SPEED
                        </button>
                        <button
                          className={`bc-unit-btn${burnPreference === 'efficiency' ? ' active' : ''}`}
                          onClick={() => setBurnPreference('efficiency')}
                        >
                          EFFICIENCY
                        </button>
                      </div>
                      <div className="bc-field-note" style={{ marginBottom: 8, paddingLeft: 118 }}>
                        {burnPreference === 'speed' ? (
                          <span style={{ color: 'var(--amber)' }}>
                            ◈ STANDARD BURN — FASTEST ARRIVAL, NO DRIFT
                          </span>
                        ) : (
                          <span style={{ color: 'var(--cyan)' }}>
                            ◈ DRIFT MODE — 2× TIME, MINIMUM REACTANT
                          </span>
                        )}
                      </div>
                    </>
                  )}

                  {/* ── Vessel Parameters ── */}
                  <div className="bc-panel-header" style={{ marginTop: 20 }}>
                    ◇ Vessel Parameters
                  </div>
                  <InputRow
                    label="Acceleration"
                    value={accel}
                    onChange={setAccel}
                    units={[]}
                    placeholder="e.g. 1.95g"
                    invalid={
                      (!solveForAccel &&
                        accel.trim() !== '' &&
                        (!isFinite(a_mps2) || a_mps2 < 0.01 * G)) ||
                      (accel.trim() === '' && !timeFilled)
                    }
                    tooltip={{
                      desc: 'Enter your desired sustained acceleration for this burn. Leave blank to solve for required acceleration from Desired Travel Time.',
                      img: TOOLTIP_IMG_ACCELERATION,
                    }}
                  />
                  <div className="bc-input-row">
                    <label className="bc-label" htmlFor="desired-travel-time">
                      Desired Travel Time
                    </label>
                    <input
                      id="desired-travel-time"
                      className={`bc-input${targetDurationError || (accel.trim() === '' && !timeFilled) ? ' invalid' : ''}`}
                      type="text"
                      placeholder="e.g. 4d 3h 2m 37s or HH:MM:SS"
                      value={targetDuration}
                      aria-invalid={
                        targetDurationError || (accel.trim() === '' && !timeFilled)
                          ? 'true'
                          : undefined
                      }
                      onChange={(e) => setTargetDuration(e.target.value)}
                    />
                  </div>
                  <div
                    className="bc-field-note"
                    style={{ marginTop: 2, marginBottom: 6, paddingLeft: 118 }}
                  >
                    {targetDurationError ? (
                      <span style={{ color: 'var(--red)' }}>
                        INVALID FORMAT — USE 4D 3H 2M 37S OR HH:MM:SS
                      </span>
                    ) : targetDurationAttempted && targetDurationValid && !solveForTime ? (
                      <span style={{ color: 'var(--green)' }}>
                        ● {formatTargetDuration(targetDuration_s)}
                      </span>
                    ) : null}
                  </div>
                  <div className="bc-input-row">
                    <label className="bc-label" htmlFor="flip-time">
                      Flip Time
                    </label>
                    <input
                      id="flip-time"
                      className={`bc-input${flipTimeError || flipTime.trim() === '' ? ' invalid' : ''}`}
                      type="text"
                      value={flipTime}
                      placeholder="e.g. 60 or 1m 30s"
                      aria-invalid={flipTimeError || flipTime.trim() === '' ? 'true' : undefined}
                      onChange={(e) => setFlipTime(e.target.value)}
                    />
                  </div>
                  {flipTimeError && (
                    <div className="bc-field-note" style={{ marginBottom: 6, paddingLeft: 118 }}>
                      <span style={{ color: 'var(--red)' }}>
                        INVALID FORMAT — USE 60, 1M 30S, ETC.
                      </span>
                    </div>
                  )}

                  {/* ── Game Clock ── */}
                  <div className="bc-panel-header" style={{ marginTop: 20 }}>
                    ◇ Game Clock
                  </div>
                  <div className="bc-input-row">
                    <div className="bc-label">
                      <Clock
                        size={10}
                        style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }}
                      />
                      Burn Start
                    </div>
                    <input
                      className={`bc-input${gameTimeError ? ' invalid' : ''}`}
                      type="text"
                      aria-label="Burn Start time"
                      placeholder="YYYY-MM-DD HH:MM:SS or HH:MM:SS"
                      value={gameStartTime}
                      aria-invalid={gameTimeError ? 'true' : undefined}
                      onChange={(e) => setGameStartTime(e.target.value)}
                    />
                  </div>
                  <div className="bc-field-note" style={{ marginTop: 6, paddingLeft: 118 }}>
                    {gameTimeError ? (
                      <span style={{ color: 'var(--red)' }}>
                        INVALID FORMAT — USE YYYY-MM-DD HH:MM:SS OR HH:MM:SS
                      </span>
                    ) : gameTimeValid ? (
                      <span style={{ color: 'var(--green)' }}>
                        ● TARGETS COMPUTED FROM GAME CLOCK
                      </span>
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
                    VCRS SHOULD BE 0.00 M/S BEFORE FINAL APPROACH — NULL CROSS-TRACK VELOCITY BEFORE
                    PROCEEDING
                  </div>
                  <InputRow
                    label="Current RNG"
                    value={faDistance}
                    onChange={setFaDistance}
                    unit={faDistanceUnit}
                    units={['km', 'gm', 'au']}
                    onUnitChange={setFaDistanceUnit}
                    placeholder="e.g. 18902"
                    invalid={faDistance.trim() === ''}
                    inputMode="decimal"
                    tooltip={{
                      desc: 'After selecting your target destination, input the distance to target.',
                      img: TOOLTIP_IMG_DISTANCE,
                    }}
                  />
                  {fa_noWakeError && (
                    <div
                      className="bc-field-note"
                      style={{ color: 'var(--red)', marginBottom: 10, paddingLeft: 118 }}
                    >
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
                    invalid={faVrel.trim() === ''}
                    inputMode="decimal"
                    tooltip={{
                      desc: "Input your vessel's current velocity to the target.",
                      img: TOOLTIP_IMG_CURRENTVEL,
                    }}
                  />

                  {/* ── Arrival Parameters ── */}
                  <div className="bc-panel-header" style={{ marginTop: 20 }}>
                    ◇ Arrival Parameters
                  </div>
                  <InputRow
                    label={noWakeEnabled ? 'Tgt Vel at 300km' : `Tgt Vel at ${standoffKm || '?'}km`}
                    value={faVArrival}
                    onChange={setFaVArrival}
                    unit={faVArrivalUnit}
                    units={['m/s', 'km/s']}
                    onUnitChange={setFaVArrivalUnit}
                    placeholder="e.g. 0"
                    inputMode="decimal"
                  />
                  <StandoffControl
                    noWakeEnabled={noWakeEnabled}
                    setNoWakeEnabled={setNoWakeEnabled}
                    standoffKm={standoffKm}
                    setStandoffKm={setStandoffKm}
                  />
                  <InputRow
                    label="Reactant Budget"
                    value={faBudget}
                    onChange={setFaBudget}
                    units={[]}
                    placeholder="e.g. 3h 30m or 12600"
                    tooltip={{
                      desc: 'Enter the amount of reactant you plan to allocate to this burn. It is not recommended to commit all your available reactant.',
                      img: TOOLTIP_IMG_REACTANTBUDGET,
                    }}
                  />
                  {faBudget.trim().length > 0 && (
                    <div className="bc-field-note" style={{ marginBottom: 6, paddingLeft: 118 }}>
                      {fa_budget_s !== null ? (
                        <span style={{ color: 'var(--green)' }}>
                          ● {formatTargetDuration(fa_budget_s)}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--red)' }}>INVALID FORMAT</span>
                      )}
                    </div>
                  )}

                  {/* ── Vessel Parameters ── */}
                  <div className="bc-panel-header" style={{ marginTop: 20 }}>
                    ◇ Vessel Parameters
                  </div>
                  <InputRow
                    label="Acceleration"
                    value={faAccel}
                    onChange={setFaAccel}
                    units={[]}
                    placeholder="e.g. 1.95g"
                    invalid={!faAccelBlank && (!isFinite(fa_a_mps2) || fa_a_mps2 < 0.01 * G)}
                    tooltip={{
                      desc: 'Enter your desired sustained acceleration for this burn. Leave blank for constant-burn mode — required G computed automatically.',
                      img: TOOLTIP_IMG_ACCELERATION,
                    }}
                  />

                  {/* ── Game Clock ── */}
                  <div className="bc-panel-header" style={{ marginTop: 20 }}>
                    ◇ Game Clock
                  </div>
                  <div className="bc-input-row">
                    <div className="bc-label">
                      <Clock
                        size={10}
                        style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }}
                      />
                      Current Time
                    </div>
                    <input
                      className={`bc-input${faGameTimeError ? ' invalid' : ''}`}
                      type="text"
                      aria-label="Current Time"
                      placeholder="YYYY-MM-DD HH:MM:SS or HH:MM:SS"
                      value={faGameStart}
                      aria-invalid={faGameTimeError ? 'true' : undefined}
                      onChange={(e) => setFaGameStart(e.target.value)}
                    />
                  </div>
                  <div className="bc-field-note" style={{ marginTop: 6, paddingLeft: 118 }}>
                    {faGameTimeError ? (
                      <span style={{ color: 'var(--red)' }}>
                        INVALID FORMAT — USE YYYY-MM-DD HH:MM:SS OR HH:MM:SS
                      </span>
                    ) : faGameTimeValid ? (
                      <span style={{ color: 'var(--green)' }}>
                        ● TARGETS COMPUTED FROM GAME CLOCK
                      </span>
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
                  <div className="bc-panel-header bc-panel-header--actions">
                    <span>◇ Burn Solution</span>
                    {planValid && (
                      <button className="bc-copy-btn" onClick={handleBurnCopy}>
                        {copied ? 'COPIED' : 'COPY'}
                      </button>
                    )}
                  </div>

                  {/* ── Pre-flight missing field check ── */}
                  {(() => {
                    const missing = [];
                    if (distance.trim() === '') missing.push('CURRENT RNG');
                    if (v0.trim() === '') missing.push('CURRENT VREL');
                    if (!solveForAccel && accel.trim() === '') missing.push('ACCELERATION');
                    if (flipTime.trim() === '') missing.push('FLIP TIME');
                    if (missing.length === 0) return null;
                    return (
                      <div className="bc-warning">
                        <AlertTriangle size={14} color="var(--red)" />
                        <div className="bc-warning-text">
                          <strong>MISSING OR INVALID INPUT</strong>
                          <br />
                          One or more fields are empty or non-numeric.
                        </div>
                      </div>
                    );
                  })()}

                  {/* Below-minimum acceleration — only when no blank required fields */}
                  {!solveForAccel &&
                    accel.trim() !== '' &&
                    isFinite(parseGValue(accel)) &&
                    parseGValue(accel) < 0.01 * G && (
                      <div className="bc-warning">
                        <AlertTriangle size={14} color="var(--red)" />
                        <div className="bc-warning-text">
                          <strong>ACCELERATION BELOW MINIMUM THRUST (0.01 G)</strong>
                          <br />
                          Enter a value of 0.01 G or higher.
                        </div>
                      </div>
                    )}

                  {/* Accel-solve error — only when no missing fields */}
                  {solveForAccel &&
                    accelSolveResult &&
                    accelSolveResult.error &&
                    isFinite(distance_m) &&
                    distance_m > 0 &&
                    isFinite(v0_mps) && (
                      <div className="bc-warning">
                        <AlertTriangle size={14} color="var(--red)" />
                        <div className="bc-warning-text">
                          <strong>{accelSolveResult.error}</strong>
                          {accelSolveResult.detail && (
                            <>
                              <br />
                              {accelSolveResult.detail}
                            </>
                          )}
                        </div>
                      </div>
                    )}

                  {/* Both fields filled — consistency validation */}
                  {validateBoth &&
                    (() => {
                      const fwdPlan = computePlan({
                        distance_m: burn_distance_m,
                        v0_mps,
                        a_mps2,
                        v_arrival_mps,
                        t_rotate_s,
                      });
                      if (fwdPlan.t_total && targetDuration_s) {
                        const diff =
                          Math.abs(fwdPlan.t_total - targetDuration_s) / targetDuration_s;
                        if (diff > 0.01) {
                          return (
                            <div className="bc-warning">
                              <AlertTriangle size={14} color="var(--red)" />
                              <div className="bc-warning-text">
                                <strong>INCONSISTENT PARAMETERS</strong>
                                <br />
                                At {(a_mps2 / G).toFixed(2)} G this burn takes{' '}
                                {formatTime(Math.floor(fwdPlan.t_total))}, not{' '}
                                {formatTargetDuration(targetDuration_s)}. Clear one field to solve
                                for it.
                              </div>
                            </div>
                          );
                        }
                      }
                      return null;
                    })()}

                  {/* plan.error — suppressed when pre-flight fires or when accel-solve already showed an error */}
                  {plan.error &&
                    isFinite(distance_m) &&
                    distance_m > 0 &&
                    isFinite(v0_mps) &&
                    (solveForAccel || isFinite(a_mps2)) &&
                    isFinite(t_rotate_s) &&
                    !(solveForAccel && accelSolveResult && accelSolveResult.error) && (
                      <div className="bc-warning">
                        <AlertTriangle size={14} color="var(--red)" />
                        <div className="bc-warning-text">
                          <strong>{plan.error}</strong>
                          {plan.detail && (
                            <>
                              <br />
                              {plan.detail}
                            </>
                          )}
                        </div>
                      </div>
                    )}

                  {plan.overshoot && (
                    <div className="bc-warning">
                      <AlertTriangle size={14} color="var(--red)" />
                      <div className="bc-warning-text">
                        <strong>CANNOT BRAKE IN TIME</strong>
                        <br />
                        {noWakeEnabled
                          ? 'Ship is moving too fast to stop before the no-wake boundary.'
                          : `Ship is moving too fast to stop before the stand-off boundary (${standoffKm} km).`}
                        <br />
                        Minimum brake distance needed:{' '}
                        <strong>{formatDistance(plan.brake_only_dist)}</strong>
                        <br />
                        Shortfall: <strong>{formatDistance(plan.shortfall)}</strong>
                        <br />
                        Reduce current velocity, lower cutoff speed, or increase distance.
                      </div>
                    </div>
                  )}

                  {plan.flip_now && !plan.error && !plan.overshoot && (
                    <div className="bc-info">
                      <strong>ROTATE NOW</strong> — at or past geometric flip point. Begin rotation
                      immediately.
                    </div>
                  )}

                  {highVcrsWarning && !plan.error && !plan.overshoot && (
                    <>
                      <div className="bc-advisory">
                        <strong>HIGH VCRS DETECTED</strong> — Cross-track velocity is{' '}
                        {formatVelocity(Math.abs(vcrs_mps))}. RCS correction will not be sufficient
                        at this magnitude.
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
                            value={
                              vcrsNullTarget
                                ? formatGameTime(vcrsNullTarget)
                                : formatTime(Math.floor(vcrsNullTime))
                            }
                            highlight
                            flickerKey={flickerKey}
                          />
                          {vcrsNullTarget && (
                            <div
                              className="bc-field-note"
                              style={{ textAlign: 'right', marginBottom: 4 }}
                            >
                              DURATION: {formatTime(Math.floor(vcrsNullTime))}
                            </div>
                          )}
                          <div
                            style={{
                              fontSize: 11,
                              color: 'var(--amber)',
                              letterSpacing: '0.1em',
                              marginBottom: 8,
                              marginTop: 6,
                              textAlign: 'right',
                              lineHeight: 1.6,
                            }}
                          >
                            BURN AT {manualNullBearing} FOR THIS DURATION — THEN RE-ENTER VALUES FOR
                            A FRESH BURN PLAN
                          </div>
                        </>
                      )}
                    </>
                  )}

                  {!plan.error && !plan.overshoot && !budgetInsufficient && (
                    <>
                      {/* ── Computed Accel — shown when solving for acceleration ── */}
                      {solveForAccel && accelSolveResult && !accelSolveResult.error && (
                        <Readout
                          label="Computed Accel"
                          value={`${(accelSolveResult.a_mps2 / G).toFixed(2)} G`}
                          highlight
                          flickerKey={flickerKey}
                        />
                      )}
                      {/* ── Section 1: Key targets ── */}
                      <Readout
                        label={isDriftMode ? 'End Accel / Begin Flip' : 'Begin Rotate'}
                        value={
                          gameTimeValid ? formatGameTime(rotateTarget) : `T+${formatTime(t_accel)}`
                        }
                        highlight
                        flickerKey={flickerKey}
                      />
                      {isDriftMode && (
                        <Readout
                          label="End Drift / Begin Brake"
                          value={
                            gameTimeValid
                              ? formatGameTime(driftEndTarget)
                              : `T+${formatTime(t_brake_start)}`
                          }
                          highlight
                          flickerKey={flickerKey}
                        />
                      )}
                      {!isDriftMode && (
                        <Readout
                          label="Begin Brake"
                          value={
                            gameTimeValid
                              ? formatGameTime(brakeTarget)
                              : `T+${formatTime(t_brake_start)}`
                          }
                          highlight
                          flickerKey={flickerKey}
                        />
                      )}
                      <Readout
                        label="Arrival"
                        value={
                          gameTimeValid ? formatGameTime(arriveTarget) : `T+${formatTime(t_total)}`
                        }
                        highlight
                        flickerKey={flickerKey}
                      />
                      <Readout
                        label="Accel Duration"
                        value={formatTime(Math.floor(t_accel))}
                        highlight
                        flickerKey={flickerKey}
                      />
                      {isDriftMode && (
                        <Readout
                          label="Drift Duration"
                          value={formatTime(Math.floor(finalPlan.t_drift || 0))}
                          highlight
                          flickerKey={flickerKey}
                        />
                      )}
                      <Readout
                        label="Brake Duration"
                        value={formatTime(Math.floor(t_total) - Math.floor(t_brake_start))}
                        highlight
                        flickerKey={flickerKey}
                      />

                      {/* ── Divider ── */}
                      {vcrs_correction_m >= burn_distance_m * 0.001 && (
                        <div className="bc-info" style={{ marginTop: 10 }}>
                          <strong>CROSS-TRACK CORRECTION APPLIED</strong> — burn distance extended
                          by {formatDistance(vcrs_correction_m)} due to VCRS drift over burn
                          duration.
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* BURN REFERENCE — right column, below Burn Solution */}
                {planValid && (
                  <div className="bc-panel scratch-b">
                    <div className="bc-panel-header">◇ Burn Reference</div>
                    <Readout
                      label="Accel Distance"
                      value={formatDistance(finalPlan.d_accel)}
                      highlight
                      flickerKey={flickerKey}
                    />
                    {isDriftMode && (
                      <Readout
                        label="Drift Distance"
                        value={formatDistance(finalPlan.d_drift)}
                        highlight
                        flickerKey={flickerKey}
                      />
                    )}
                    <Readout
                      label="Brake Distance"
                      value={formatDistance(finalPlan.d_brake)}
                      highlight
                      flickerKey={flickerKey}
                    />
                    <Readout
                      label="Total Distance"
                      value={formatDistance(burn_distance_m)}
                      highlight
                      flickerKey={flickerKey}
                    />
                    <Readout
                      label="Peak Velocity"
                      value={formatVelocity(finalPlan.v_max)}
                      highlight
                      flickerKey={flickerKey}
                    />
                  </div>
                )}
              </div>
            )}

            {/* FINAL APPROACH results */}
            {appMode === 'approach' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="bc-panel scratch-b">
                  <div className="bc-panel-header bc-panel-header--actions">
                    <span>◇ Approach Solution</span>
                    {faPlanOk && (
                      <button className="bc-copy-btn" onClick={handleFaCopy}>
                        {copied ? 'COPIED' : 'COPY'}
                      </button>
                    )}
                  </div>

                  {/* ── FA pre-flight missing field check ── */}
                  {(faDistance.trim() === '' || faVrel.trim() === '') && (
                    <div className="bc-warning">
                      <AlertTriangle size={14} color="var(--red)" />
                      <div className="bc-warning-text">
                        <strong>MISSING OR INVALID INPUT</strong>
                        <br />
                        One or more fields are empty or non-numeric.
                      </div>
                    </div>
                  )}

                  {/* FA below-minimum entered acceleration */}
                  {!faAccelBlank &&
                    isFinite(parseGValue(faAccel)) &&
                    parseGValue(faAccel) < 0.01 * G && (
                      <div className="bc-warning">
                        <AlertTriangle size={14} color="var(--red)" />
                        <div className="bc-warning-text">
                          <strong>ACCELERATION BELOW MINIMUM THRUST (0.01 G)</strong>
                          <br />
                          Enter a value of 0.01 G or higher.
                        </div>
                      </div>
                    )}

                  {/* FA constant-burn below-minimum computed acceleration */}
                  {faAccelBlank && fa_required_a_belowMin && (
                    <div className="bc-warning">
                      <AlertTriangle size={14} color="var(--red)" />
                      <div className="bc-warning-text">
                        <strong>
                          REQUIRED DECELERATION BELOW MINIMUM THRUST (0.01 G) — CHECK UNITS OR
                          INCREASE RANGE
                        </strong>
                      </div>
                    </div>
                  )}

                  {faPlan && faPlan.error && (
                    <div className="bc-warning">
                      <AlertTriangle size={14} color="var(--red)" />
                      <div className="bc-warning-text">
                        <strong>{faPlan.error}</strong>
                        {faPlan.detail && (
                          <>
                            <br />
                            {faPlan.detail}
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {faPlan && faPlan.overshoot && (
                    <div className="bc-warning">
                      <AlertTriangle size={14} color="var(--red)" />
                      <div className="bc-warning-text">
                        <strong>CANNOT BRAKE IN TIME — OVERSHOOT IMMINENT</strong>
                        <br />
                        At {formatVelocity(fa_v0_mps)} closing, you cannot stop before the{' '}
                        {noWakeEnabled
                          ? 'no-wake boundary'
                          : `stand-off boundary (${standoffKm} km)`}{' '}
                        at{' '}
                        {formatDistance(
                          fa_a_mps2 > 0
                            ? (fa_v0_mps * fa_v0_mps -
                                (isFinite(fa_v_arrival_mps)
                                  ? fa_v_arrival_mps * fa_v_arrival_mps
                                  : 0)) /
                                (2 * fa_a_mps2)
                            : 0
                        )}{' '}
                        brake distance needed.
                        <br />
                        Shortfall:{' '}
                        <strong>
                          {isFinite(faPlan.shortfall) ? formatDistance(faPlan.shortfall) : '—'}
                        </strong>
                        <br />
                        Required deceleration:{' '}
                        <strong>
                          {isFinite(faPlan.required_a)
                            ? (faPlan.required_a / G).toFixed(2) + ' G'
                            : '—'}
                        </strong>{' '}
                        — exceeds available{' '}
                        {isFinite(fa_a_mps2) ? (fa_a_mps2 / G).toFixed(2) + ' G' : '—'}.<br />
                        The solver cannot recover this approach. Reduce closing velocity immediately
                        if possible.
                      </div>
                    </div>
                  )}

                  {faPlanOk && (
                    <>
                      {/* Required G vs available G — or constant-burn mode */}
                      {(() => {
                        const req_g = faPlan.required_a / G;
                        if (faAccelBlank) {
                          return (
                            <div className="bc-fa-ok">
                              {`● CONSTANT BURN — REQUIRED: ${req_g.toFixed(2)} G`}
                            </div>
                          );
                        }
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

                      {/* Reactant sufficiency at operating acceleration */}
                      {fa_reactant_ok !== null && (
                        <div className={fa_reactant_ok ? 'bc-fa-ok' : 'bc-fa-warn'}>
                          {fa_reactant_ok
                            ? `● REACTANT SUFFICIENT — BRAKE REQUIRES ${formatTargetDuration(Math.floor(faPlan.t_brake))}, BUDGET IS ${formatTargetDuration(Math.floor(fa_budget_s))}`
                            : `⚠ REACTANT DEFICIT — BRAKE REQUIRES ${formatTargetDuration(Math.floor(faPlan.t_brake))}, BUDGET IS ONLY ${formatTargetDuration(Math.floor(fa_budget_s))}`}
                        </div>
                      )}

                      {/* Throttled-G reactant line — only when accel entered and required_a < fa_a_mps2 */}
                      {fa_throttled_brake_s !== null && (
                        <div className={fa_throttled_ok ? 'bc-fa-ok' : 'bc-fa-warn'}>
                          {fa_throttled_ok
                            ? `● IF THROTTLED TO ${(faPlan.required_a / G).toFixed(2)} G — BRAKE REQUIRES ${formatTargetDuration(Math.floor(fa_throttled_brake_s))}, BUDGET SUFFICIENT`
                            : `⚠ IF THROTTLED TO ${(faPlan.required_a / G).toFixed(2)} G — BRAKE REQUIRES ${formatTargetDuration(Math.floor(fa_throttled_brake_s))}, BUDGET INSUFFICIENT`}
                        </div>
                      )}

                      {faPlan.t_coast > 1 ? (
                        <>
                          <Readout
                            label="Begin Brake"
                            value={
                              faGameTimeValid
                                ? formatGameTime(faBrakeTarget)
                                : `T+${formatTime(Math.floor(faPlan.t_coast))}`
                            }
                            highlight
                            flickerKey={flickerKey}
                          />
                          {faBrakeTarget && (
                            <div
                              className="bc-field-note"
                              style={{ textAlign: 'right', marginBottom: 4 }}
                            >
                              COAST {formatTime(Math.floor(faPlan.t_coast))} BEFORE IGNITION
                            </div>
                          )}
                          {!faGameTimeValid && (
                            <div
                              className="bc-field-note"
                              style={{ textAlign: 'right', marginBottom: 4 }}
                            >
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
                        value={
                          faGameTimeValid
                            ? formatGameTime(faArriveTarget)
                            : `T+${formatTime(Math.floor(faPlan.t_total))}`
                        }
                        highlight
                        flickerKey={flickerKey}
                      />
                      <Readout
                        label="Brake Duration"
                        value={formatTime(Math.floor(faPlan.t_brake))}
                        highlight
                        flickerKey={flickerKey}
                      />
                      <Readout
                        label="Brake Distance"
                        value={formatDistance(faPlan.d_brake)}
                        highlight
                        flickerKey={flickerKey}
                      />
                      {faPlan.d_coast > 0 && (
                        <Readout
                          label="Coast Distance"
                          value={formatDistance(faPlan.d_coast)}
                          highlight
                          flickerKey={flickerKey}
                        />
                      )}
                    </>
                  )}

                  {!faPlan && (
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--text-dim)',
                        letterSpacing: '0.08em',
                        padding: '12px 0',
                      }}
                    >
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
                      <div
                        className="bc-timeline-phase accel"
                        style={{ left: 0, width: `${accelPct}%` }}
                      >
                        {accelPct > 8 ? 'ACCEL' : ''}
                      </div>
                    )}
                    {t_rot > 0 && (
                      <div
                        className="bc-timeline-phase rotate"
                        style={{ left: `${accelPct}%`, width: `${rotPct}%` }}
                      >
                        {rotPct > 6 ? 'ROT' : ''}
                      </div>
                    )}
                    {isDriftMode && driftPct > 0 && (
                      <div
                        className="bc-timeline-phase drift"
                        style={{ left: `${accelPct + rotPct}%`, width: `${driftPct}%` }}
                      >
                        {driftPct > 8 ? 'DRIFT' : ''}
                      </div>
                    )}
                    <div
                      className="bc-timeline-phase brake"
                      style={{ left: `${accelPct + rotPct + driftPct}%`, width: `${brakePct}%` }}
                    >
                      {brakePct > 8 ? 'BRAKE' : ''}
                    </div>
                    <div className="bc-timeline-tick" style={{ left: 0 }}>
                      T+0
                    </div>
                    {t_accel > 0 && rotPct >= 10 && (
                      <div className="bc-timeline-tick key" style={{ left: `${accelPct}%` }}>
                        ↺ FLIP
                      </div>
                    )}
                    {isDriftMode && driftPct >= 5 && (
                      <div
                        className="bc-timeline-tick key"
                        style={{ left: `${accelPct + rotPct + driftPct}%` }}
                      >
                        ⊖ BRAKE
                      </div>
                    )}
                    {!isDriftMode && t_accel > 0 && rotPct >= 10 && (
                      <div
                        className="bc-timeline-tick key"
                        style={{ left: `${accelPct + rotPct}%` }}
                      >
                        ⊖ BRAKE
                      </div>
                    )}
                    {!isDriftMode && t_accel > 0 && rotPct < 10 && (
                      <div
                        className="bc-timeline-tick key"
                        style={{ left: `${accelPct + rotPct / 2}%` }}
                      >
                        ↺→⊖ FLIP
                      </div>
                    )}
                    {t_accel === 0 && (
                      <div className="bc-timeline-tick key" style={{ left: `${rotPct}%` }}>
                        ⊖ BRAKE
                      </div>
                    )}
                    <div
                      className="bc-timeline-tick"
                      style={{ left: '100%', transform: 'translateX(-100%)' }}
                    >
                      ◉ ARRIVE
                    </div>
                  </>
                ) : (
                  <>
                    <div className="bc-timeline-phase accel" style={{ left: 0, width: '33.33%' }}>
                      ?
                    </div>
                    <div
                      className="bc-timeline-phase rotate"
                      style={{ left: '33.33%', width: '33.34%' }}
                    >
                      ?
                    </div>
                    <div
                      className="bc-timeline-phase brake"
                      style={{ left: '66.67%', width: '33.33%' }}
                    >
                      ?
                    </div>
                    <div className="bc-timeline-tick" style={{ left: 0 }}>
                      T+0
                    </div>
                    <div
                      className="bc-timeline-tick"
                      style={{ left: '100%', transform: 'translateX(-100%)' }}
                    >
                      ◉ ARRIVE
                    </div>
                  </>
                )}
              </div>

              <div className="bc-targets-grid">
                <TargetCell
                  variant="rotate"
                  label={
                    planValid
                      ? isDriftMode
                        ? '↺ End Accel / Flip'
                        : '↺ Begin Rotate'
                      : '↺ Begin Rotate'
                  }
                  gameTime={planValid ? rotateTarget : null}
                  relative={planValid ? `T+${formatTime(t_accel)}` : '--:--:--'}
                />
                <TargetCell
                  variant="brake"
                  label={
                    planValid
                      ? isDriftMode
                        ? '⊖ End Drift / Brake'
                        : '⊖ Begin Brake'
                      : '⊖ Begin Brake'
                  }
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
                <div
                  style={{
                    marginTop: 12,
                    fontSize: 10,
                    color: 'var(--text-dim)',
                    letterSpacing: '0.1em',
                    textAlign: 'center',
                  }}
                >
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

function InputRow({
  label,
  value,
  onChange,
  unit,
  units,
  onUnitChange,
  tooltip,
  placeholder,
  invalid,
  inputMode = 'text',
}) {
  const id = React.useId();
  const [showTip, setShowTip] = React.useState(false);
  const [tipPos, setTipPos] = React.useState({ top: 0, left: 0 });
  const badgeRef = React.useRef(null);
  const cardRef = React.useRef(null);

  const openTip = () => {
    if (badgeRef.current) {
      const rect = badgeRef.current.getBoundingClientRect();
      setTipPos({ top: rect.bottom + 6, left: rect.left });
    }
    setShowTip(true);
  };

  // After the card renders, measure its real height and reposition if needed
  React.useEffect(() => {
    if (!showTip || !cardRef.current || !badgeRef.current) return;
    const card = cardRef.current;
    const rect = badgeRef.current.getBoundingClientRect();
    const cardHeight = card.offsetHeight;
    const spaceBelow = window.innerHeight - rect.bottom - 6;
    const spaceAbove = rect.top - 6;
    const top =
      spaceBelow >= cardHeight || spaceBelow >= spaceAbove
        ? rect.bottom + 6
        : Math.max(8, rect.top - cardHeight - 6);
    setTipPos({ top, left: rect.left });
  }, [showTip]);

  return (
    <div className="bc-input-row">
      <label className="bc-label" htmlFor={id} style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ flex: 1 }}>{label}</span>
        {tooltip && (
          <span className="bc-tooltip-wrap">
            <button
              type="button"
              className="bc-tooltip-badge"
              ref={badgeRef}
              aria-label={`Help for ${label}`}
              onMouseEnter={openTip}
              onMouseLeave={() => setShowTip(false)}
              onFocus={openTip}
              onBlur={() => setShowTip(false)}
            >
              ?
            </button>
            {showTip && (
              <div
                className="bc-tooltip-card"
                ref={cardRef}
                style={{ top: tipPos.top, left: tipPos.left }}
              >
                <div className="bc-tooltip-header">{label}</div>
                <div className="bc-tooltip-desc">{tooltip.desc}</div>
                {tooltip.img && (
                  <img
                    className="bc-tooltip-img"
                    src={tooltip.img}
                    alt={label}
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                )}
              </div>
            )}
          </span>
        )}
      </label>
      <input
        id={id}
        className={`bc-input${invalid ? ' invalid' : ''}`}
        type="text"
        inputMode={inputMode}
        value={value}
        placeholder={placeholder || ''}
        aria-invalid={invalid ? 'true' : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {units && units.length > 0 && (
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
      )}
    </div>
  );
}

function Readout({ label, value, highlight, flickerKey }) {
  const [animClass, setAnimClass] = React.useState('');
  const isFirst = React.useRef(true);
  React.useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    setAnimClass('flicker');
    const t = setTimeout(() => setAnimClass(''), 200);
    return () => clearTimeout(t);
  }, [flickerKey]);
  const cls = [highlight ? 'highlight' : '', animClass].filter(Boolean).join(' ');
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
