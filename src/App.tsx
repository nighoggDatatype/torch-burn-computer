import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, Clock } from 'lucide-react';
import './styles.css';
import {
  G,
  AU,
  NO_WAKE_M,
} from './utils/constants.js';
import {
  parseNum,
  parseGValue,
  parseGameTime,
  parseTargetDuration,
} from './utils/parsers.js';
import {
  formatTime,
  formatDistance,
  formatVelocity,
  addGameTime,
  formatGameTime,
  formatTargetDuration,
} from './utils/formatters.js';
import {
  computeFinalApproach,
} from './solvers/physics.js';
import ErrorBoundary from './components/ErrorBoundary.js';
import Readout from './components/Readout.js';
import InputRow from './components/InputRow.js';
import { _urlParams, _urlParams_localStorage, _localStorage, _save_localStorage } from './utils/persistence.js';
import StandoffControl from './components/StandoffControl.js';
import Timeline from './ui/Timeline.js';
import BurnOutput from './ui/BurnOutput.js';
import { badInputError, getStandOffError, getV0Error, targetAccelTooSmallError } from './utils/errors.js';
import { accelOnlySolver, budgetOnlySolver, durationOnlySolver, optimalAccelSolver, optimalBudgetSolver, optimalDurationSolver } from './solvers/burnSolvers.js';
import BurnInput from './ui/BurnInput.js';

const APP_VERSION = 'v0.6.4';

// Embedded screenshot data for tooltips
const TOOLTIP_IMG_DISTANCE = `${import.meta.env.BASE_URL}tooltips/distance.jpg`;
const TOOLTIP_IMG_CURRENTVEL = `${import.meta.env.BASE_URL}tooltips/current-vel.jpg`;
const TOOLTIP_IMG_VCRS = `${import.meta.env.BASE_URL}tooltips/vcrs.jpg`;
const TOOLTIP_IMG_REACTANTBUDGET = `${import.meta.env.BASE_URL}tooltips/reactantbudget.jpg`;
const TOOLTIP_IMG_ACCELERATION = `${import.meta.env.BASE_URL}tooltips/acceleration.jpg`;

export default function BurnCalculator() {
  return (
    <ErrorBoundary>
      <BurnCalculatorInner />
    </ErrorBoundary>
  );
}

function BurnCalculatorInner() {
  // -- boot sequence state --
  const [booting, setBooting] = useState(() => {
    try {
      return !sessionStorage.getItem('pa_booted');
    } catch {
      return false;
    }
  });
  const [bootFade, setBootFade] = useState(false);
  const [visibleLines, setVisibleLines] = useState<number[]>([]);

  useEffect(() => {
    if (!booting) return;
    try {
      sessionStorage.setItem('pa_booted', '1');
    } catch {
      /* restricted context - skip */
    }
    const timers: (number | undefined)[] = [];
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

  // -- Final Approach state - per-burn fields from URL only, vessel/prefs from URL→LS --
  const [faDistance, setFaDistance] = useState(() => _urlParams('fad') ?? '');
  const [faDistanceUnit, setFaDistanceUnit] = useState(() => _urlParams_localStorage('fadu', 'pa_fadu', 'km'));
  const [faVrel, setFaVrel] = useState(() => _urlParams('fav') ?? '');
  const [faVrelUnit, setFaVrelUnit] = useState(() => _urlParams_localStorage('favu', 'pa_favu', 'm/s'));
  const [faAccel, setFaAccel] = useState(() => _urlParams_localStorage('faa', 'pa_fa_accel', ''));
  const [faBudget, setFaBudget] = useState(() => _urlParams('fab') ?? '');
  const [faVArrival, setFaVArrival] = useState(() => _urlParams('fava') ?? '0');
  const [faVArrivalUnit, setFaVArrivalUnit] = useState(() => _urlParams_localStorage('fvau', 'pa_fvau', 'm/s'));
  const [faGameStart, setFaGameStart] = useState(() => _urlParams('fgt') ?? '');

  // Burn Plan state - per-burn fields from URL only, vessel/prefs from URL→LS
  const [distance, setDistance] = useState(() => _urlParams('d') ?? '');
  const [distanceUnit, setDistanceUnit] = useState(() => _urlParams_localStorage('du', 'pa_du', 'km'));
  const [vrel, setVrel] = useState(() => _urlParams('v') ?? '');
  const [vrelUnit, setVrelUnit] = useState(() => _urlParams_localStorage('vu', 'pa_vu', 'm/s'));
  const [v0Direction, setV0Direction] = useState(() => _urlParams('vd') ?? 'closing');
  const [accel, setAccel] = useState(() => _urlParams_localStorage('a', 'pa_accel', ''));
  const [flipTime, setFlipTime] = useState(() => _urlParams_localStorage('f', 'pa_flip_time', '60'));
  const [reactantBudget, setReactantBudget] = useState(() => _urlParams('b') ?? '');
  const [vArrival, setVArrival] = useState(() => _urlParams('va') ?? '0');
  const [vArrivalUnit, setVArrivalUnit] = useState(() => _urlParams_localStorage('vau', 'pa_vau', 'm/s'));
  const [vcrs, setVcrs] = useState(() => _urlParams('cx') ?? '');
  const [vcrsUnit, setVcrsUnit] = useState(() => _urlParams('cu') ?? 'm/s');
  const [noWakeEnabled, setNoWakeEnabled] = useState(() => {
    const u = _urlParams('nw');
    if (u !== null) return u !== '0';
    const l = _localStorage('pa_no_wake');
    return l !== null ? l !== '0' : true;
  });
  const [standoffKm, setStandoffKm] = useState(() => _urlParams_localStorage('sk', 'pa_standoff_km', '2.5'));
  const [targetDuration, setTargetDuration] = useState(() => _urlParams('td') ?? '');
  const [gameStartTime, setGameStartTime] = useState(() => _urlParams('gt') ?? '');

  // -- flicker state (feature 11) --
  const [flickerKey, setFlickerKey] = useState(0);
  const prevPlanRef: React.RefObject<string|null> = useRef(null);

  // -- URL state sync - update address bar whenever any input changes ------
  useEffect(() => {
    const p = new URLSearchParams();
    if (distance) p.set('d', distance);
    if (distanceUnit !== 'km') p.set('du', distanceUnit);
    if (vrel) p.set('v', vrel);
    if (vrelUnit !== 'm/s') p.set('vu', vrelUnit);
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
    distance, distanceUnit, vrel, vrelUnit, v0Direction, accel, flipTime, reactantBudget,
    vArrival, vArrivalUnit, vcrs, vcrsUnit, noWakeEnabled, standoffKm, targetDuration,
    gameStartTime, faDistance, faDistanceUnit, faVrel, faVrelUnit,
    faAccel, faBudget, faVArrival, faVArrivalUnit, faGameStart, appMode,
  ]);

  // -- localStorage sync - vessel params and preferences only ---------------
  useEffect(() => {
    _save_localStorage('pa_accel', accel || null);
    _save_localStorage('pa_fa_accel', faAccel || null);
    _save_localStorage('pa_flip_time', flipTime !== '60' ? flipTime : null);
    _save_localStorage('pa_no_wake', noWakeEnabled ? '1' : '0');
    _save_localStorage('pa_standoff_km', standoffKm !== '2.5' ? standoffKm : null);
    _save_localStorage('pa_du', distanceUnit !== 'km' ? distanceUnit : null);
    _save_localStorage('pa_vu', vrelUnit !== 'm/s' ? vrelUnit : null);
    _save_localStorage('pa_vau', vArrivalUnit !== 'm/s' ? vArrivalUnit : null);
    _save_localStorage('pa_fadu', faDistanceUnit !== 'km' ? faDistanceUnit : null);
    _save_localStorage('pa_favu', faVrelUnit !== 'm/s' ? faVrelUnit : null);
    _save_localStorage('pa_fvau', faVArrivalUnit !== 'm/s' ? faVArrivalUnit : null);
  }, [
    accel, faAccel, flipTime, noWakeEnabled, standoffKm,
    distanceUnit, vrelUnit, vArrivalUnit, faDistanceUnit, faVrelUnit, faVArrivalUnit,
  ]);

  // -- mode switch - copies shared fields (range, vrel) on transition --------
  function switchMode(newMode: React.SetStateAction<string>) {
    if (newMode === 'approach' && appMode === 'burn') {
      if (!faDistance && distance) {
        setFaDistance(distance);
        setFaDistanceUnit(distanceUnit);
      }
      if (!faVrel && vrel) {
        setFaVrel(vrel);
        setFaVrelUnit(vrelUnit);
      }
    } else if (newMode === 'burn' && appMode === 'approach') {
      if (!distance && faDistance) {
        setDistance(faDistance);
        setDistanceUnit(faDistanceUnit);
      }
      if (!vrel && faVrel) {
        setVrel(faVrel);
        setVrelUnit(faVrelUnit);
      }
    }
    setAppMode(newMode);
  }

  // -- copy-to-clipboard state ----------------------------------------------
  const [copied, setCopied] = useState(false);

  function handleBurnCopy() {
    if (!finalPlan || finalPlan.error !== null || finalPlan.overshoot)
    {
      return;
    }
    const lines = [];
    const distLabel =
      distanceUnit === 'au' ? 'AU' : distanceUnit === 'gm' ? 'GM' : distanceUnit === 'km' ? 'km' : 'm';
    lines.push('-- CURRENT STATE --');
    lines.push(`Range: ${distance} ${distLabel}`);
    lines.push(`VREL: ${vrel} ${vrelUnit} (${v0Direction.toUpperCase()})`);
    if (vcrs.trim() !== '') lines.push(`VCRS: ${vcrs} ${vcrsUnit}`);
    lines.push('');
    lines.push('-- ARRIVAL PARAMETERS --');
    if (vArrival.trim() !== '' && vArrival !== '0') lines.push(`TGT Vel: ${vArrival} ${vArrivalUnit}`);
    lines.push(noWakeEnabled ? 'Stand-off: NO-WAKE ZONE (300 km)' : `Stand-off: ${standoffKm} km`);
    if (reactantBudget.trim() !== '') lines.push(`Reactant Budget: ${reactantBudget}`);
    lines.push('');
    lines.push('-- VESSEL PARAMETERS --');
    if (solveForAccel && finalPlanOk) {
      lines.push(`Acceleration: ${(finalPlan.a_mps2 / G).toFixed(2)} G (computed)`);
    } else {
      lines.push(`Acceleration: ${accel} G`);
    }
    lines.push(`Flip Time: ${flipTime}`);
    if (targetDuration.trim() !== '') lines.push(`Desired Travel Time: ${targetDuration}`);
    if (gameStartTime.trim() !== '') {
      lines.push('');
      lines.push('-- GAME CLOCK --');
      lines.push(`Current Time: ${gameStartTime}`);
    }
    lines.push('');
    lines.push('-- BURN SOLUTION --');
    lines.push(
      `${isDriftMode ? 'End Accel / Begin Flip' : 'Begin Rotate'}: ${gameTimeValid ? formatGameTime(rotateTarget) : 'T+' + formatTargetDuration(Math.floor(t_accel))}`
    );
    if (isDriftMode) {
      lines.push(
        `End Drift / Begin Brake: ${gameTimeValid ? formatGameTime(driftEndTarget) : 'T+' + formatTargetDuration(Math.floor(t_brake_start))}`
      );
    } else {
      lines.push(
        `Begin Brake: ${gameTimeValid ? formatGameTime(brakeTarget) : 'T+' + formatTargetDuration(Math.floor(t_brake_start))}`
      );
    }
    lines.push(
      `Arrival: ${gameTimeValid ? formatGameTime(arriveTarget) : 'T+' + formatTargetDuration(Math.floor(t_total))}`
    );
    lines.push(`Accel Duration: ${formatTargetDuration(Math.floor(t_accel)) ?? '0S'}`);
    if (isDriftMode)
      lines.push(
        `Drift Duration: ${formatTargetDuration(Math.floor(finalPlan.t_drift || 0)) ?? '0S'}`
      );
    lines.push(
      `Brake Duration: ${formatTargetDuration(Math.floor(t_total) - Math.floor(t_brake_start)) ?? '0S'}`
    );
    lines.push('');
    lines.push('-- BURN REFERENCE --');
    lines.push(`Accel Distance: ${formatDistance(finalPlan.d_accel)}`);
    if (isDriftMode) lines.push(`Drift Distance: ${formatDistance(finalPlan.d_drift)}`);
    lines.push(`Brake Distance: ${formatDistance(finalPlan.d_brake)}`);
    lines.push(`Total Distance: ${formatDistance(burn_distance_m)}`);
    lines.push(`Peak Velocity: ${formatVelocity(finalPlan.v_max)}`);
    lines.push(
      `Min Reactant Budget: ${(((finalPlan.t_accel || 0) + (finalPlan.t_brake || 0)) / 3600).toFixed(2)}h`
    );
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleFaCopy() {
    if (!faPlan || faPlan.error !== null || faPlan.overshoot)
    {
      return;
    }
    const lines = [];
    const faDistLabel =
      faDistanceUnit === 'au' ? 'AU' : faDistanceUnit === 'gm' ? 'GM' : 'km';
    lines.push('-- CURRENT STATE --');
    lines.push(`Range: ${faDistance} ${faDistLabel}`);
    lines.push(`VREL: ${faVrel} ${faVrelUnit} (CLOSING)`);
    lines.push('');
    lines.push('-- ARRIVAL PARAMETERS --');
    if (faVArrival.trim() !== '' && faVArrival !== '0')
      lines.push(`TGT Vel: ${faVArrival} ${faVArrivalUnit}`);
    lines.push(noWakeEnabled ? 'Stand-off: NO-WAKE ZONE (300 km)' : `Stand-off: ${standoffKm} km`);
    if (faBudget.trim() !== '') lines.push(`Reactant Budget: ${faBudget}`);
    lines.push('');
    lines.push('-- VESSEL PARAMETERS --');
    lines.push(
      faAccelBlank
        ? `Acceleration: ${(faPlan.required_a / G).toFixed(2)} G (computed)`
        : `Acceleration: ${faAccel} G`
    );
    if (faGameStart.trim() !== '') {
      lines.push('');
      lines.push('-- GAME CLOCK --');
      lines.push(`Current Time: ${faGameStart}`);
    }
    lines.push('');
    lines.push('-- APPROACH SOLUTION --');
    if (faPlan.t_coast > 1) {
      lines.push(
        `Begin Brake: ${faGameTimeValid ? formatGameTime(faBrakeTarget) : 'T+' + formatTargetDuration(Math.floor(faPlan.t_coast))}`
      );
    }
    lines.push(
      `Arrival: ${faGameTimeValid ? formatGameTime(faArriveTarget) : 'T+' + formatTargetDuration(Math.floor(faPlan.t_total))}`
    );
    lines.push(`Brake Duration: ${formatTargetDuration(Math.floor(faPlan.t_brake)) ?? '0S'}`);
    lines.push(`Brake Distance: ${formatDistance(faPlan.d_brake)}`);
    if (faPlan.d_coast > 0) lines.push(`Coast Distance: ${formatDistance(faPlan.d_coast)}`);
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // Required Fields
  const standoff_m = noWakeEnabled ? NO_WAKE_M : parseNum(standoffKm) * 1000 || 0;
  const standoffValid =
    noWakeEnabled || (isFinite(parseNum(standoffKm)) && parseNum(standoffKm) > 0);
  
  const distance_m =
    parseNum(distance) *
    (distanceUnit === 'au' ? AU : distanceUnit === 'gm' ? 1e9 : distanceUnit === 'km' ? 1000 : 1);
 
  const vrel_mps =
    parseNum(vrel) * (vrelUnit === 'km/s' ? 1000 : 1) * (v0Direction === 'receding' ? -1 : 1); //TODO: Make changes here to account for the fact this includes vcrs, and may be angled
  const vcrs_mps = vcrs.trim() !== '' ? parseNum(vcrs) * (vcrsUnit === 'km/s' ? 1000 : 1) : 0;
  const v_arrival_mps = vArrival.trim() === '' ? 0 : parseNum(vArrival) * (vArrivalUnit === 'km/s' ? 1000 : 1);
  
  const t_rotate_s_parsed = parseTargetDuration(flipTime);
  const t_rotate_s = t_rotate_s_parsed !== null ? t_rotate_s_parsed : parseNum(flipTime) || 0;
 
  const flipTimeAttempted = flipTime.trim() !== '';
  const flipTimeValid = t_rotate_s_parsed !== null;
  const flipTimeError = flipTimeAttempted && !flipTimeValid;

  // -- Desired Travel Time: parse input --
  const targetDurationAttempted = targetDuration.trim() !== '';
  const targetDuration_s = parseTargetDuration(targetDuration);
  const targetDurationValid = targetDuration_s !== null;
  const targetDurationError = targetDurationAttempted && !targetDurationValid;
  const targetDurationFilled = targetDurationAttempted && targetDurationValid;

  // -- Reactant budget: parse input --
  const budgetAttempted = reactantBudget.trim() !== '';
  const targetBudget_s = parseTargetDuration(reactantBudget)
  const targetBudgetValid = targetBudget_s !== null;
  const targetBudgetError = budgetAttempted && !targetBudgetValid;
  const targetBudgetFilled = budgetAttempted && targetBudgetValid;
  
  // -- Acceleration: parse input --
  const targetAccelAttempted = accel.trim() !== '';
  const targetAccel_mps2 = parseGValue(accel);
  const targetAccelTooSmall = isFinite(targetAccel_mps2) && targetAccel_mps2 < 0.01 * G;
  const targetAccelValid = isFinite(targetAccel_mps2) && !targetAccelTooSmall;
  const targetAccelError = targetAccelAttempted && !targetAccelValid;
  const targetAccelFilled = targetAccelAttempted && targetAccelValid;
  
  const solveForAccel = !targetAccelAttempted && (targetDurationFilled || targetBudgetFilled);

  // Double plan switches
  const optimizeAccel = targetBudgetFilled && targetDurationFilled;
  const optimizeBudget = targetDurationFilled && targetAccelFilled;
  const optimizeDuration = targetBudgetFilled && targetAccelFilled;

  // Plan group switches
  const tripleConstraintSolving = targetBudgetFilled && targetDurationFilled && targetAccelFilled;
  const doubleConstraintSolving = optimizeAccel || optimizeBudget || optimizeDuration;
  const anyConstraintAttempted = targetDurationAttempted || budgetAttempted || targetAccelAttempted

  const burnMissingFields = [
    ...(!isFinite(distance_m) ? ['CURRENT RNG'] : []),
    ...(!isFinite(vrel_mps) ? ['CURRENT VREL'] : []),
    ...(!isFinite(vcrs_mps) ? ['VCRS'] : []),
    ...(!isFinite(v_arrival_mps) ? ['CUTOFF VELOCITY'] : []),
    ...(!flipTimeValid ? ['FLIP TIME'] : []),
    ...((!anyConstraintAttempted || targetDurationError) ? ['TRAVEL TIME'] : []),
    ...((!anyConstraintAttempted || targetBudgetError) ? ['REACTANT BUDGET'] : []),
    ...((!anyConstraintAttempted || (targetAccelAttempted && !isFinite(targetAccel_mps2))) ? ['ACCELERATION'] : []),
  ]
  // Standoff error checking
  const standoffError = !standoffValid
    ? 'invalid-standoff'
    : isFinite(distance_m) && distance_m <= standoff_m
      ? 'within-standoff'
      : null;
  const hasWakeError = standoffError !== null;
  const burn_distance_m = hasWakeError ? NaN : distance_m - standoff_m;

  // v0 error checking
  const v0_squared = vrel_mps * vrel_mps - vcrs_mps - vcrs_mps;
  const hasV0Error = !isFinite(v0_squared) || v0_squared < 0;
  const v0_mps = hasV0Error ? NaN : Math.sqrt(v0_squared);

  const inputError = 
      burnMissingFields.length > 0 ? badInputError :
      targetAccelTooSmall ? targetAccelTooSmallError :
      hasWakeError ? getStandOffError({standoffError, noWakeEnabled, standoffKm}) :
      hasV0Error ? getV0Error({vcrs_mps}) : 
      null
  
  const accelOnlyConstantBurnPlan = targetAccelFilled
    ? accelOnlySolver({burn_distance_m, v0_mps, targetAccel_mps2, v_arrival_mps, t_rotate_s})
    : null;

  const budgetOnlyConstantBurnPlan = targetBudgetFilled 
    ? budgetOnlySolver({burn_distance_m , v0_mps, targetBudget_s, v_arrival_mps, t_rotate_s})
    : null;

  const durationOnlyConstantBurnPlan = targetDurationFilled
    ? durationOnlySolver({burn_distance_m , v0_mps, targetDuration_s, v_arrival_mps, t_rotate_s})
    : null;

  const optimalBudgetPlan = optimizeBudget 
  ? optimalBudgetSolver({
    accelOnlyConstantBurnPlan, durationOnlyConstantBurnPlan,
    burn_distance_m, v0_mps, v_arrival_mps, t_rotate_s,
    targetDuration_s, targetAccel_mps2
  }) : null
  const optimalDurationPlan = optimizeDuration 
  ? optimalDurationSolver({
    budgetOnlyConstantBurnPlan, accelOnlyConstantBurnPlan,
    burn_distance_m, v0_mps, v_arrival_mps, t_rotate_s,
    targetAccel_mps2, targetBudget_s
    }): null
  const optimalAccelPlan = optimizeAccel 
  ? optimalAccelSolver({
    budgetOnlyConstantBurnPlan, durationOnlyConstantBurnPlan,
    burn_distance_m, v0_mps, v_arrival_mps, t_rotate_s,
    targetDuration_s, targetBudget_s
  }) : null

  const doublePlan = optimalBudgetPlan ?? optimalDurationPlan ?? optimalAccelPlan;
  const singlePlan = accelOnlyConstantBurnPlan ?? budgetOnlyConstantBurnPlan ?? durationOnlyConstantBurnPlan;
  const finalPlanIgnoreInputErrors = doubleConstraintSolving ? doublePlan : singlePlan;
  const finalPlan = inputError ?? finalPlanIgnoreInputErrors
  const finalPlanOk = finalPlan !== null && finalPlan.error === null && !finalPlan.overshoot;
  const isDriftMode = finalPlanOk && finalPlan.t_drift !== 0 && finalPlan.d_drift !== 0;

  //Temp finalPlanUnpacking (TODO: Refactor)
  const a_mps2 = finalPlanOk ? finalPlan.a_mps2 : NaN;

  // VCRS advisory threshold - warn when cross-track drift extends burn distance by >5%
  const vcrs_drift_m = finalPlanOk ? finalPlan.t_total * vcrs_mps : NaN;
  const highVcrsWarning = vcrs_drift_m >= burn_distance_m * 0.05;

  // Manual null heading + null time for high VCRS warning
  const vcrsNullTime =
    highVcrsWarning && isFinite(vcrs_mps) && isFinite(a_mps2) && a_mps2 > 0
      ? Math.abs(vcrs_mps) / a_mps2
      : null;

  const manualNullBearing =
    highVcrsWarning && isFinite(vcrs_mps) ? (vcrs_mps >= 0 ? '90.00°' : '270.00°') : null;

  // -- Final Approach calculations --
  const fa_distance_m_raw =
    parseNum(faDistance) * (faDistanceUnit === 'au' ? AU : faDistanceUnit === 'gm' ? 1e9 : 1000);
  const fa_brake_distance_m = isFinite(fa_distance_m_raw) ? fa_distance_m_raw - standoff_m : NaN;
  const fa_v0_mps = parseNum(faVrel) * (faVrelUnit === 'km/s' ? 1000 : 1);
  const fa_v_arrival_mps =
    faVArrival.trim() === '' ? 0 : parseNum(faVArrival) * (faVArrivalUnit === 'km/s' ? 1000 : 1);

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

  // FA budget conversion - parsed same as Desired Travel Time (bare number = seconds)
  const fa_budget_s = (() => {
    const parsed = parseTargetDuration(faBudget);
    return parsed !== null && parsed > 0 ? parsed : NaN;
  })();

  const faMissingFields = [
    (faDistance.trim() === '' || !isFinite(fa_distance_m_raw)) && 'RANGE',
    (faVrel.trim() === '' || !isFinite(fa_v0_mps)) && 'CLOSING VELOCITY',
    !faAccelBlank && !isFinite(parseGValue(faAccel)) && 'ACCELERATION',
    faVArrival.trim() !== '' && !isFinite(fa_v_arrival_mps) && 'CUTOFF VELOCITY',
  ].filter(Boolean);

  // Stand-off error for FA (mirrors burn-mode logic)
  const fa_standoffError = !standoffValid
    ? 'invalid-standoff'
    : isFinite(fa_distance_m_raw) && fa_distance_m_raw <= standoff_m
      ? 'within-standoff'
      : null;
  const fa_hasWakeError = fa_standoffError !== null;

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
  const faPlanOk = faPlan !== null && faPlan.error === null && !faPlan.overshoot;

  // Reactant sufficiency for FA at operating acceleration (full thrust or computed)
  const fa_reactant_ok =
    fa_budget_s !== null && faPlanOk
      ? fa_budget_s >= faPlan.t_brake
      : null; // null = no budget entered, don't show

  // Throttled-G reactant check: when player has an available accel AND required_a < fa_a_mps2,
  // show a second line for what happens if they throttle down to required_a.
  // Not shown in constant-burn mode (faAccelBlank) since there's only one accel in play.
  const fa_throttled_brake_s =
    !faAccelBlank &&
    fa_budget_s !== null &&
    faPlanOk &&
    isFinite(faPlan.required_a) &&
    isFinite(fa_a_mps2) &&
    faPlan.required_a < fa_a_mps2 - 1e-6
      ? (fa_v0_mps - fa_v_arrival_mps) / faPlan.required_a
      : null;
  const fa_throttled_ok =
    fa_throttled_brake_s !== null && fa_budget_s !== null ? fa_budget_s >= fa_throttled_brake_s : null;
  // Budget-floor G: lowest throttle that still completes the brake within the current budget.
  // Only shown alongside the throttle-down caution when full-thrust reactant is sufficient.
  const fa_budget_floor_g =
    fa_throttled_ok === false && fa_reactant_ok === true && fa_budget_s !== null && fa_budget_s > 0
      ? (fa_v0_mps - fa_v_arrival_mps) / fa_budget_s / G
      : null;

  // FA game clock
  const faParsedGameTime = parseGameTime(faGameStart);
  const faGameTimeValid = faParsedGameTime !== null;
  const faGameTimeAttempted = faGameStart.trim() !== '';
  const faGameTimeError = faGameTimeAttempted && !faGameTimeValid;

  const faBrakeTarget =
    faGameTimeValid && faPlanOk ? addGameTime(faParsedGameTime, faPlan.t_coast) : null;
  const faArriveTarget =
    faGameTimeValid && faPlanOk ? addGameTime(faParsedGameTime, faPlan.t_total) : null;

  // Status for FA mode
  const faStatusText = !faPlan
    ? 'STANDBY'
    : faPlan.error !== null
      ? 'INVALID'
      : faPlan.overshoot
        ? 'OVERSHOOT'
        : 'READY';

  // Flicker effect: trigger when plan output changes
  useEffect(() => {
    const key = JSON.stringify({
      required_a: faPlanOk ? faPlan.required_a : null,
      t_accel: faPlanOk ? faPlan.t_brake : null,
      t_total: faPlanOk ? faPlan.t_total : null,
      error: faPlan ? faPlan.error: null,
    });
    if (prevPlanRef.current !== null && prevPlanRef.current !== key) {
      setFlickerKey((k) => k + 1);
    }
    prevPlanRef.current = key;
  }, [
        faPlanOk ? faPlan.required_a : null,
        faPlanOk ? faPlan.t_brake : null,
        faPlanOk ? faPlan.t_total : null,
        faPlan ? faPlan.error: null
      ]);

  // Game time parsing
  const parsedGameTime = parseGameTime(gameStartTime);
  const gameTimeValid = parsedGameTime !== null;
  const gameTimeAttempted = gameStartTime.trim() !== '';
  const gameTimeError = gameTimeAttempted && !gameTimeValid;

  const t_accel = finalPlanOk ? finalPlan.t_accel : 0;
  const t_rot = finalPlanOk ? finalPlan.t_rotate : 0;
  const t_drift = finalPlanOk ? finalPlan.t_drift : 0;
  const t_total = finalPlanOk ? finalPlan.t_total : 0;
  const t_flip_end = t_accel + t_rot;
  const t_brake_start = isDriftMode ? t_flip_end + t_drift : t_flip_end;

  const rotateTarget = gameTimeValid && finalPlanOk ? addGameTime(parsedGameTime, t_accel) : null;
  const driftEndTarget =
    gameTimeValid && finalPlanOk && isDriftMode ? addGameTime(parsedGameTime, t_brake_start) : null;
  const brakeTarget = gameTimeValid && finalPlanOk ? addGameTime(parsedGameTime, t_brake_start) : null;
  const arriveTarget = gameTimeValid && finalPlanOk ? addGameTime(parsedGameTime, t_total) : null;

  const statusText = 
    finalPlan === null ? 'STANDBY' :
    finalPlan.error !== null ? 'INVALID' :
    finalPlan.overshoot ? 'OVERSHOOT' :
    'READY';

  // Combined status for header light - mode-aware
  const activeStatusText = appMode === 'approach' ? faStatusText : statusText;
  const activeHasError =
    appMode === 'approach'
      ? faPlan && (faPlan.error || fa_hasWakeError)
      : (finalPlan && finalPlan.error !== null);
  const activeIsOvershoot = appMode === 'approach' ? faPlan && faPlan.error === null && faPlan.overshoot : finalPlan && finalPlan.error === null && finalPlan.overshoot;

  const burnInputArgs = {
    distance, setDistance, distanceUnit, setDistanceUnit, 
    vrel, setVrel, vrelUnit, setVrelUnit,
    v0Direction, setV0Direction,
    vcrs, setVcrs, vcrsUnit, setVcrsUnit,
    vArrival, setVArrival, vArrivalUnit, setVArrivalUnit,
    noWakeEnabled, setNoWakeEnabled, standoffKm, setStandoffKm, standoffError,
    accel, setAccel, targetAccelError,
    targetDuration, setTargetDuration, targetDurationError, targetDuration_s,
    reactantBudget, setReactantBudget, targetBudgetError, targetBudget_s,
    flipTime, setFlipTime, flipTimeError,
    gameStartTime, setGameStartTime, gameTimeError, gameTimeValid,
    isDriftMode, anyConstraintAttempted
  }

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
              <span className="bc-status-text" role="status" aria-live="polite">{activeStatusText}</span>
            </div>
          </div>

          <div className="bc-grid">
            {/* INPUTS */}
            <div className="bc-panel scratch-a">
              {/* -- Mode toggle -- */}
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
                <BurnInput args={burnInputArgs}/>
              )}

              {appMode === 'approach' && (
                <>
                  {/* -- Current State -- */}
                  <div className="bc-panel-header">◇ Current State</div>
                  <div className="bc-fa-notice">
                    VCRS SHOULD BE 0.00 M/S BEFORE FINAL APPROACH - NULL CROSS-TRACK VELOCITY BEFORE
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
                  {fa_hasWakeError && (
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

                  {/* -- Arrival Parameters -- */}
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
                    standoffError={standoffError}
                  />

                  {/* -- Trip Parameters -- */}
                  <div className="bc-panel-header" style={{ marginTop: 20 }}>
                    ◇ Trip Parameters
                  </div>
                  <InputRow
                    label="Acceleration"
                    value={faAccel}
                    onChange={setFaAccel}
                    units={[]}
                    placeholder="e.g. 1.95g"
                    invalid={!faAccelBlank && (!isFinite(fa_a_mps2) || fa_a_mps2 < 0.01 * G)}
                    tooltip={{
                      desc: 'Enter your desired sustained acceleration for this burn. Leave blank for constant-burn mode - required G computed automatically.',
                      img: TOOLTIP_IMG_ACCELERATION,
                    }}
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
                  {faBudget.trim() !== '' && (
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

                  {/* -- Game Clock -- */}
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
                        INVALID FORMAT - USE YYYY-MM-DD HH:MM:SS OR HH:MM:SS
                      </span>
                    ) : faGameTimeValid ? (
                      <span style={{ color: 'var(--green)' }}>
                        ● TARGETS COMPUTED FROM GAME CLOCK
                      </span>
                    ) : (
                      <span>LEAVE BLANK FOR RELATIVE (T+) TIMES - DATE OPTIONAL</span>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* RIGHT COLUMN - mode-conditional */}
            {appMode === 'burn' && (
              <BurnOutput 
              finalPlan={finalPlan} 
              parsedGameTime={parsedGameTime} 
              input={{vcrs_mps, inputAccel_mps: solveForAccel ? null : targetAccel_mps2, burn_distance_m, noWakeEnabled, standoffKm}}
              copied={copied}
              handleCopy={handleBurnCopy}
            />)}

            {/* FINAL APPROACH results */}
            {appMode === 'approach' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="bc-panel scratch-b" aria-live="polite" aria-atomic="false">
                  <div className="bc-panel-header bc-panel-header--actions">
                    <span>◇ Approach Solution</span>
                    {faPlanOk && (
                      <button className="bc-copy-btn" onClick={handleFaCopy}>
                        {copied ? 'COPIED' : 'COPY'}
                      </button>
                    )}
                  </div>

                  {/* -- FA pre-flight missing field check -- */}
                  {faMissingFields.length > 0 && (
                    <div className="bc-warning" role="alert">
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
                      <div className="bc-warning" role="alert">
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
                    <div className="bc-warning" role="alert">
                      <AlertTriangle size={14} color="var(--red)" />
                      <div className="bc-warning-text">
                        <strong>
                          REQUIRED DECELERATION BELOW MINIMUM THRUST (0.01 G) - CHECK UNITS OR
                          INCREASE RANGE
                        </strong>
                      </div>
                    </div>
                  )}

                  {faPlan && faPlan.error && !faMissingFields.length && (
                    <div className="bc-warning" role="alert">
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

                  {faPlan && faPlan.error === null && faPlan.overshoot && (
                    <div className="bc-warning" role="alert">
                      <AlertTriangle size={14} color="var(--red)" />
                      <div className="bc-warning-text">
                        <strong>CANNOT BRAKE IN TIME - OVERSHOOT IMMINENT</strong>
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
                          {isFinite(faPlan.shortfall) ? formatDistance(faPlan.shortfall) : '-'}
                        </strong>
                        <br />
                        Required deceleration:{' '}
                        <strong>
                          {isFinite(faPlan.required_a)
                            ? (faPlan.required_a / G).toFixed(2) + ' G'
                            : '-'}
                        </strong>{' '}
                        - exceeds available{' '}
                        {isFinite(fa_a_mps2) ? (fa_a_mps2 / G).toFixed(2) + ' G' : '-'}.<br />
                        The solver cannot recover this approach. Reduce closing velocity immediately
                        if possible.
                      </div>
                    </div>
                  )}

                  {faPlanOk && (
                    <>
                      {/* Required G vs available G - or constant-burn mode */}
                      {(() => {
                        const req_g = faPlan.required_a / G;
                        if (faAccelBlank) {
                          return (
                            <div className="bc-fa-ok">
                              {`● CONSTANT BURN - REQUIRED: ${req_g.toFixed(2)} G`}
                            </div>
                          );
                        }
                        const avail_g = fa_a_mps2 / G;
                        const gOk = isFinite(req_g) && isFinite(avail_g) && req_g <= avail_g;
                        return (
                          <div className={gOk ? 'bc-fa-ok' : 'bc-fa-warn'}>
                            {gOk
                              ? `● DECELERATION OK - REQUIRED: ${req_g.toFixed(2)} G / AVAILABLE: ${avail_g.toFixed(2)} G`
                              : `⚠ DECELERATION MARGINAL - REQUIRED: ${req_g.toFixed(2)} G / AVAILABLE: ${avail_g.toFixed(2)} G - EXCEEDING RATED THRUST IS RISKY`}
                          </div>
                        );
                      })()}

                      {/* Reactant sufficiency at operating acceleration */}
                      {fa_reactant_ok !== null && (
                        <div className={fa_reactant_ok ? 'bc-fa-ok' : 'bc-fa-warn'}>
                          {fa_reactant_ok
                            ? `● REACTANT SUFFICIENT - BRAKE REQUIRES ${formatTargetDuration(Math.floor(faPlan.t_brake))}, BUDGET IS ${formatTargetDuration(Math.floor(fa_budget_s))}`
                            : `⚠ REACTANT DEFICIT - BRAKE REQUIRES ${formatTargetDuration(Math.floor(faPlan.t_brake))}, BUDGET IS ONLY ${formatTargetDuration(Math.floor(fa_budget_s))}`}
                        </div>
                      )}

                      {/* Throttled-G reactant line - only when accel entered and required_a < fa_a_mps2 */}
                      {fa_throttled_brake_s !== null && (
                        <div className={fa_throttled_ok ? 'bc-fa-ok' : 'bc-advisory'}>
                          {fa_throttled_ok
                            ? `● IF THROTTLED TO ${(faPlan.required_a / G).toFixed(2)} G - BRAKE REQUIRES ${formatTargetDuration(Math.floor(fa_throttled_brake_s))}, BUDGET SUFFICIENT`
                            : `NOTE: THROTTLING DOWN TO ${(faPlan.required_a / G).toFixed(2)} G WOULD EXTEND BRAKING BURN TO ${formatTargetDuration(Math.floor(fa_throttled_brake_s))} - REACTANT BUDGET INSUFFICIENT FOR MINIMUM ACCELERATION BURN BASED ON CURRENT SETTINGS.`}
                        </div>
                      )}
                      {fa_budget_floor_g !== null && (
                        <div className="bc-fa-ok">
                          {`● AT CURRENT BUDGET - MINIMUM THROTTLE IS ${fa_budget_floor_g.toFixed(2)} G`}
                        </div>
                      )}

                      {faPlan.t_coast > 1 ? (
                        <>
                          <Readout
                            label="Begin Brake"
                            value={
                              faGameTimeValid
                                ? formatGameTime(faBrakeTarget)
                                : `T+${formatTargetDuration(Math.floor(faPlan.t_coast))}`
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
                          ⚠ BRAKE NOW - YOU ARE AT OR PAST THE BRAKE INITIATION POINT
                        </div>
                      )}

                      <Readout
                        label="Arrival"
                        value={
                          faGameTimeValid
                            ? formatGameTime(faArriveTarget)
                            : `T+${formatTargetDuration(Math.floor(faPlan.t_total))}`
                        }
                        highlight
                        flickerKey={flickerKey}
                      />
                      <Readout
                        label="Brake Duration"
                        value={formatTargetDuration(Math.floor(faPlan.t_brake)) ?? '0S'}
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

          {/* TIMELINE + GAME-TIME TARGETS - burn mode only */}
          {appMode === 'burn' && (<Timeline finalPlan={finalPlan} parsedGameTime={parsedGameTime}/>)}
        </div>
      </div>
    </>
  );
}

