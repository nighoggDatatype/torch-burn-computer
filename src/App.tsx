import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, Clock } from 'lucide-react';
import './styles.css';
import {
  G,
  AU,
  NO_WAKE_M,
  TOOLTIP_IMG_DISTANCE,
  TOOLTIP_IMG_ACCELERATION,
  TOOLTIP_IMG_CURRENTVEL,
  TOOLTIP_IMG_REACTANTBUDGET,
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
import ErrorBoundary from './components/ErrorBoundary.js';
import Readout from './components/Readout.js';
import InputRow from './components/InputRow.js';
import { _urlParams, _urlParams_localStorage, _localStorage, _save_localStorage } from './utils/persistence.js';
import StandoffControl from './components/StandoffControl.js';
import Timeline from './ui/Timeline.js';
import BurnOutput from './ui/BurnOutput.js';
import { badInputError, finalApproach_computedDecelTooFast, getStandOffError, getV0Error, targetAccelTooSmallError } from './utils/errors.js';
import { accelOnlySolver, budgetOnlySolver, durationOnlySolver, optimalAccelSolver, optimalBudgetSolver, optimalDurationSolver } from './solvers/burnSolvers.js';
import BurnInput from './ui/BurnInput.js';
import { computeFinalApproach_constantBurn, computeFinalApproach_givenAccel } from './solvers/approachSolvers.js';
import ApproachInput from './ui/ApproachInput.js';

const APP_VERSION = 'v0.6.4';

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
  const [faGameStartTime, setFaGameStartTime] = useState(() => _urlParams('fgt') ?? '');

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
    if (faGameStartTime) p.set('fgt', faGameStartTime);
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
    faAccel, faBudget, faVArrival, faVArrivalUnit, faGameStartTime, appMode,
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
      !faTargetAccelAttempted
        ? `Acceleration: ${(fa_required_a_mps2 / G).toFixed(2)} G (computed)`
        : `Acceleration: ${faAccel} G`
    );
    if (faGameStartTime.trim() !== '') {
      lines.push('');
      lines.push('-- GAME CLOCK --');
      lines.push(`Current Time: ${faGameStartTime}`);
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

  // -- Final Approach calculations --
  const fa_distance_m_raw =
    parseNum(faDistance) * (faDistanceUnit === 'au' ? AU : faDistanceUnit === 'gm' ? 1e9 : 1000);
  const fa_brake_distance_m = isFinite(fa_distance_m_raw) ? fa_distance_m_raw - standoff_m : NaN;
  const fa_v0_mps = parseNum(faVrel) * (faVrelUnit === 'km/s' ? 1000 : 1);
  const fa_v_arrival_mps =
    faVArrival.trim() === '' ? 0 : parseNum(faVArrival) * (faVArrivalUnit === 'km/s' ? 1000 : 1);

  const faTargetAccelAttempted = faAccel.trim() !== '';
  const faTargetAccel_mps2 = parseGValue(faAccel);
  const faTargetAccelTooSmall = isFinite(faTargetAccel_mps2) && faTargetAccel_mps2 < 0.01 * G
  const faTargetAccelValid = isFinite(faTargetAccel_mps2) && !faTargetAccelTooSmall
  const faTargetAccelError = faTargetAccelAttempted && !faTargetAccelValid

  const faConstantBurnPlan = computeFinalApproach_constantBurn({ 
    distance_m: fa_brake_distance_m, 
    v0_mps : fa_v0_mps, 
    v_arrival_mps : fa_v_arrival_mps 
  });

  const fa_required_a_mps2 = 
    faConstantBurnPlan && faConstantBurnPlan.error === null
      ? faConstantBurnPlan.a_mps2
      : NaN;
  // Reject computed acceleration below minimum viable thrust (0.01 G)
  const fa_required_a_belowMin =
    isFinite(fa_required_a_mps2) && fa_required_a_mps2 < 0.01 * G;
  // Operating acceleration: computed required_a when blank (and above floor), otherwise player input
  const fa_a_mps2 = !faTargetAccelAttempted
    ? isFinite(fa_required_a_mps2) && !fa_required_a_belowMin
      ? fa_required_a_mps2
      : NaN
    : faTargetAccelTooSmall 
      ? NaN
      : faTargetAccel_mps2

  // FA budget conversion - parsed same as Desired Travel Time (bare number = seconds)
  const faTargetBudgetAttempted = faBudget.trim() !== ''
  const faTargetBudget_s = parseTargetDuration(faBudget);
  const faTargetBudgetValid = faTargetBudget_s !== null && faTargetBudget_s > 0; //TODO: Peel positive check out
  const faTargetBudgetError = faTargetBudgetAttempted && !faTargetBudgetValid

  const faMissingFields = [
    ...(!isFinite(fa_distance_m_raw) ? ['RANGE'] : []),
    ...(!isFinite(fa_v0_mps) ? ['CLOSING VELOCITY'] : []),
    ...((!!faTargetAccelAttempted && !isFinite(faTargetAccel_mps2)) ? ['ACCELERATION'] : []),
    ...((faVArrival.trim() !== '' && !isFinite(fa_v_arrival_mps)) ? ['CUTOFF VELOCITY'] : []),
  ];

  // Stand-off error for FA (mirrors burn-mode logic)
  const fa_standoffError = !standoffValid
    ? 'invalid-standoff'
    : isFinite(fa_distance_m_raw) && fa_distance_m_raw <= standoff_m
      ? 'within-standoff'
      : null;
  const fa_hasWakeError = fa_standoffError !== null;

  const faInputError = 
      faMissingFields.length > 0 ? badInputError :
      faTargetAccelTooSmall ? targetAccelTooSmallError :
      fa_hasWakeError ? getStandOffError({standoffError : fa_standoffError, noWakeEnabled, standoffKm}) :
      null
  
  const faPlanAccel = faTargetAccelValid ? 
    computeFinalApproach_givenAccel({
      distance_m: fa_brake_distance_m,
      v0_mps: fa_v0_mps,
      a_mps2: faTargetAccel_mps2,
      v_arrival_mps: fa_v_arrival_mps,
    }) : null;
  const faPlanIgnoreInputErrors = faPlanAccel ?? faConstantBurnPlan
  const faPlanRaw = faInputError ?? faPlanIgnoreInputErrors
  const faPlanCanCheck = faPlanRaw.error === null && !faPlanRaw.overshoot;
  const faPlanErrors = !faPlanCanCheck ? null :
    faPlanRaw.a_mps2 < 0.01 * G ? finalApproach_computedDecelTooFast
    : null;
  const faPlan = faPlanErrors ?? faPlanRaw;
  const faPlanOk = faPlan.error === null && !faPlan.overshoot;

  // Reactant sufficiency for FA at operating acceleration (full thrust or computed)
  const fa_reactant_ok = faTargetBudgetValid && faPlanOk
      ? faTargetBudget_s >= faPlan.t_brake
      : null; // null = no budget entered, don't show

  // Throttled-G reactant check: when player has an available accel AND required_a < fa_a_mps2,
  // show a second line for what happens if they throttle down to required_a.
  // Not shown in constant-burn mode (!faTargetAccelAttempted) since there's only one accel in play.
  const fa_throttled_brake_s =
    !faTargetAccelAttempted &&
    faConstantBurnPlan.error === null &&
    fa_required_a_mps2 < fa_a_mps2 - 1e-6
      ? faConstantBurnPlan.t_brake
      : null;
  const fa_throttled_ok =
    fa_throttled_brake_s !== null && faTargetBudget_s !== null ? faTargetBudget_s >= fa_throttled_brake_s : null;
  // Budget-floor G: lowest throttle that still completes the brake within the current budget.
  // Only shown alongside the throttle-down caution when full-thrust reactant is sufficient.
  const fa_budget_floor_g =
    fa_throttled_ok === false && fa_reactant_ok === true && faTargetBudget_s !== null && faTargetBudget_s > 0
      ? (fa_v0_mps - fa_v_arrival_mps) / faTargetBudget_s / G
      : null;

  // FA game clock (TODO: Consider just using one game time globally)
  const faParsedGameTime = parseGameTime(faGameStartTime);
  const faGameTimeValid = faParsedGameTime !== null;
  const faGameTimeAttempted = faGameStartTime.trim() !== '';
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
      a_mps2: faPlanOk ? faPlan.a_mps2 : null,
      t_accel: faPlanOk ? faPlan.t_brake : null,
      t_total: faPlanOk ? faPlan.t_total : null,
      error: faPlan.error,
    });
    if (prevPlanRef.current !== null && prevPlanRef.current !== key) {
      setFlickerKey((k) => k + 1);
    }
    prevPlanRef.current = key;
  }, [
        faPlanOk ? faPlan.a_mps2 : null,
        faPlanOk ? faPlan.t_brake : null,
        faPlanOk ? faPlan.t_total : null,
        faPlan.error
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
  const approachInputArgs = {
      faDistance, setFaDistance, faDistanceUnit, setFaDistanceUnit,
      faVrel, setFaVrel, faVrelUnit, setFaVrelUnit,
      faVArrival, setFaVArrival, faVArrivalUnit, setFaVArrivalUnit,
      faAccel, setFaAccel, faTargetAccelError,
      faBudget, setFaBudget, faTargetBudgetError, faTargetBudget_s, 
      noWakeEnabled, setNoWakeEnabled, standoffKm, setStandoffKm, standoffError,
      faGameStartTime, setFaGameStartTime, faGameTimeError, faGameTimeValid
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
                <ApproachInput args={approachInputArgs}/>
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

                  {faPlan && faPlan.error && (
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
                        const req_g = fa_required_a_mps2 / G;
                        if (faPlan.d_coast === 0 && faPlan.t_coast === 0) {
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
                      {faTargetBudgetValid && (
                        <div className={fa_reactant_ok ? 'bc-fa-ok' : 'bc-fa-warn'}>
                          {fa_reactant_ok
                            ? `● REACTANT SUFFICIENT - BRAKE REQUIRES ${formatTargetDuration(Math.floor(faPlan.t_brake))}, BUDGET IS ${formatTargetDuration(Math.floor(faTargetBudget_s))}`
                            : `⚠ REACTANT DEFICIT - BRAKE REQUIRES ${formatTargetDuration(Math.floor(faPlan.t_brake))}, BUDGET IS ONLY ${formatTargetDuration(Math.floor(faTargetBudget_s))}`}
                        </div>
                      )}

                      {/* Throttled-G reactant line - only when accel entered and required_a < fa_a_mps2 */}
                      {fa_throttled_brake_s !== null && (
                        <div className={fa_throttled_ok ? 'bc-fa-ok' : 'bc-advisory'}>
                          {fa_throttled_ok
                            ? `● IF THROTTLED TO ${(fa_required_a_mps2 / G).toFixed(2)} G - BRAKE REQUIRES ${formatTargetDuration(Math.floor(fa_throttled_brake_s))}, BUDGET SUFFICIENT`
                            : `NOTE: THROTTLING DOWN TO ${(fa_required_a_mps2 / G).toFixed(2)} G WOULD EXTEND BRAKING BURN TO ${formatTargetDuration(Math.floor(fa_throttled_brake_s))} - REACTANT BUDGET INSUFFICIENT FOR MINIMUM ACCELERATION BURN BASED ON CURRENT SETTINGS.`}
                        </div>
                      )}
                      {fa_budget_floor_g !== null && (
                        <div className="bc-fa-ok">
                          {`● AT CURRENT BUDGET - MINIMUM THROTTLE IS ${fa_budget_floor_g.toFixed(2)} G`}
                        </div>
                      )}

                      {faPlan.t_coast > 1 ? (
                        <Readout
                          label= "End Drift / Begin Brake"
                          value={
                            faGameTimeValid
                              ? formatGameTime(faBrakeTarget)
                              : `T+${formatTargetDuration(Math.floor(faPlan.t_coast))}`
                          }
                          highlight
                          flickerKey={flickerKey}
                        />
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
                      {faPlan.t_coast > 0 && (
                        <Readout
                          label="Coast Duration"
                          value={formatTargetDuration(Math.floor(faPlan.t_coast)) ?? '0S'}
                          highlight
                          flickerKey={flickerKey}
                        />
                      )}
                      <Readout
                        label="Brake Duration"
                        value={formatTargetDuration(Math.floor(faPlan.t_brake)) ?? '0S'}
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
                      <Readout
                        label="Brake Distance"
                        value={formatDistance(faPlan.d_brake)}
                        highlight
                        flickerKey={flickerKey}
                      />
                    </>
                  )}

                  {!faPlan && ( //TODO: Properly use this as an element for empty stuff
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

