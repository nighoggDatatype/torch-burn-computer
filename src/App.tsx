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
import ErrorBoundary from './components/ErrorBoundary.js';
import useUrlOrLocalState from './utils/persistence.js';
import Timeline from './ui/Timeline.js';
import BurnOutput from './ui/BurnOutput.js';
import { badInputError, computedAccelTooFast as computedAccelTooSlow, finalApproach_computedDecelTooFast as finalApproach_computedDecelTooSlow, getStandOffError, getV0Error, internalSolverError, targetAccelTooSmallError } from './utils/errors.js';
import { accelOnlySolver, budgetOnlySolver, durationOnlySolver, optimalAccelSolver, optimalBudgetSolver, optimalDurationSolver } from './solvers/burnSolvers.js';
import BurnInput from './ui/BurnInput.js';
import { computeFinalApproach_constantBurn, computeFinalApproach_givenAccel, computeFinalApproach_givenBudget } from './solvers/approachSolvers.js';
import ApproachInput from './ui/ApproachInput.js';
import BootSplash from './ui/BootSplash.js';
import ApproachOutput from './ui/ApproachOutput.js';
import AppHeader from './ui/AppHeader.js';
import { IsPlanValid } from './solvers/physics.js';

export default function BurnCalculator() {
  return (
    <ErrorBoundary>
      <BurnCalculatorInner />
    </ErrorBoundary>
  );
}

function BurnCalculatorInner() {

  // appMode: read from URL hash (#burn / #approach)
  const [appMode, setAppMode] = useUrlOrLocalState({urlKey: null, defaultValue: 'burn', validValues: ['approach', 'burn']})

  // Shared settings: stand-off is pref so gets local storage, wake/nowake represents target type category
  // TODO: Consider whether to split between burn and approach, rather than share 
  const [standoffKm, setStandoffKm] = useUrlOrLocalState({urlKey: 'sk', localKey: 'pa_standoff_km', defaultValue: '2.5'})
  const [noWakeEnabled, setNoWakeEnabled] = useUrlOrLocalState({urlKey: 'nw', localKey: 'pa_no_wake', defaultValue: 'disabled', validValues: ['enabled', 'disabled']})

  // Burn Plan settings: per-burn fields from URL only, vessel/prefs also has local storage
  const [distance, setDistance] = useUrlOrLocalState({urlKey: 'd', defaultValue: ''})
  const [distanceUnit, setDistanceUnit] = useUrlOrLocalState({urlKey: 'du', localKey: 'pa_du', defaultValue: 'km', validValues: ['km', 'gm', 'au']})
  const [vrel, setVrel] = useUrlOrLocalState({urlKey: 'v', defaultValue: ''})
  const [vrelUnit, setVrelUnit] = useUrlOrLocalState({urlKey: 'vu', localKey: 'pa_vu', defaultValue: "m/s", validValues: ['m/s', 'km/s']})
  const [v0Direction, setV0Direction] = useUrlOrLocalState({urlKey: 'vd', defaultValue: 'closing', validValues: ['closing', 'receding']})
  const [vcrs, setVcrs] = useUrlOrLocalState({urlKey: 'cx', defaultValue: ''})
  const [vcrsUnit, setVcrsUnit] = useUrlOrLocalState({urlKey: 'cu', defaultValue: 'm/s', validValues: ['m/s', 'km/s']})
  const [vArrival, setVArrival] = useUrlOrLocalState({urlKey: 'va', defaultValue: ''})
  const [vArrivalUnit, setVArrivalUnit] = useUrlOrLocalState({urlKey: 'vau', localKey: 'pa_vau', defaultValue: 'm/s', validValues: ['m/s', 'km/s']})
  const [accel, setAccel] = useUrlOrLocalState({urlKey: 'a',localKey: 'pa_accel', defaultValue: ''})
  const [targetDuration, setTargetDuration] = useUrlOrLocalState({urlKey: 'td', defaultValue: ''})
  const [reactantBudget, setReactantBudget] = useUrlOrLocalState({urlKey: 'b', defaultValue: ''})
  const [flipTime, setFlipTime] = useUrlOrLocalState({urlKey: 'f',localKey: 'pa_flip_time', defaultValue: '60'})
  const [gameStartTime, setGameStartTime] = useUrlOrLocalState({urlKey: 'gt', defaultValue: ''})

  // Final Approach settings: per-burn fields from URL only, vessel/prefs also has local storage
  const [faDistance, setFaDistance] = useUrlOrLocalState({urlKey: 'fad', defaultValue: ''})
  const [faDistanceUnit, setFaDistanceUnit] = useUrlOrLocalState({urlKey: 'fadu', localKey: 'pa_fadu', defaultValue: 'km', validValues: ['km', 'gm', 'au']})
  const [faVrel, setFaVrel] = useUrlOrLocalState({urlKey: 'fav', defaultValue: ''})
  const [faVrelUnit, setFaVrelUnit] = useUrlOrLocalState({urlKey: 'favu', localKey: 'pa_favu', defaultValue: "m/s", validValues: ['m/s', 'km/s']})
  const [faVArrival, setFaVArrival] = useUrlOrLocalState({urlKey: 'fava', defaultValue: ''})
  const [faVArrivalUnit, setFaVArrivalUnit] = useUrlOrLocalState({urlKey: 'fvau', localKey: 'pa_fvau', defaultValue: 'm/s', validValues: ['m/s', 'km/s']})
  const [faAccel, setFaAccel] = useUrlOrLocalState({urlKey: 'faa',localKey: 'pa_fa_accel', defaultValue: ''})
  const [faBudget, setFaBudget] = useUrlOrLocalState({urlKey: 'fab', defaultValue: ''})
  const [faGameStartTime, setFaGameStartTime] = useUrlOrLocalState({urlKey: 'fgt', defaultValue: ''})

  // Mode switch - copies valid shared fields (range, vrel) on transition
  function switchMode(newMode: string) {
    if (newMode === 'approach' && appMode === 'burn') {
      if (faDistance.trim() === "" && isFinite(distance_m)) {
        setFaDistance(distance);
        setFaDistanceUnit(distanceUnit);
      }
      if (faDistance.trim() === "" && isFinite(vrel_mps)) {
        setFaVrel(vrel);
        setFaVrelUnit(vrelUnit);
      }
      if (!faGameTimeAttempted && gameTimeValid) {
        setFaGameStartTime(gameStartTime);
      }
    } else if (newMode === 'burn' && appMode === 'approach') {
      if (distance.trim() === "" && isFinite(fa_distance_m)) {
        setDistance(faDistance);
        setDistanceUnit(faDistanceUnit);
      }
      if (vrel.trim() === "" && fa_v0_mps) {
        setVrel(faVrel);
        setVrelUnit(faVrelUnit);
      }
      if (!gameTimeAttempted && faGameTimeValid){
        setGameStartTime(faGameStartTime);
      }
    }
    setAppMode(newMode);
  }

  // Required Fields
  const standoff_m = noWakeEnabled ? NO_WAKE_M : parseNum(standoffKm) * 1000;
  const standoffValid =
    noWakeEnabled || (isFinite(parseNum(standoffKm)) && parseNum(standoffKm) > 0);
  
  const distance_m =
    parseNum(distance) *
    (distanceUnit === 'au' ? AU : distanceUnit === 'gm' ? 1e9 : distanceUnit === 'km' ? 1000 : 1);
 
  const vrel_mps =
    parseNum(vrel) * (vrelUnit === 'km/s' ? 1000 : 1) * (v0Direction === 'receding' ? -1 : 1); 
  const vcrs_mps = vcrs.trim() !== '' ? parseNum(vcrs) * (vcrsUnit === 'km/s' ? 1000 : 1) : 0;
  const v_arrival_mps = vArrival.trim() !== '' ? parseNum(vArrival) * (vArrivalUnit === 'km/s' ? 1000 : 1) : 0;
  
  const flipTimeAttempted = flipTime.trim() !== '';
  const t_rotate_s = parseTargetDuration(flipTime) ?? NaN;
  const flipTimeValid = isFinite(t_rotate_s);
  const flipTimeError = flipTimeAttempted && !flipTimeValid;

  // Desired Travel Time: parse input
  const targetDurationAttempted = targetDuration.trim() !== '';
  const targetDuration_s = parseTargetDuration(targetDuration);
  const targetDurationValid = targetDuration_s !== null;
  const targetDurationError = targetDurationAttempted && !targetDurationValid;
  const targetDurationFilled = targetDurationAttempted && targetDurationValid;

  // Reactant budget: parse input
  const budgetAttempted = reactantBudget.trim() !== '';
  const targetBudget_s = parseTargetDuration(reactantBudget)
  const targetBudgetValid = targetBudget_s !== null;
  const targetBudgetError = budgetAttempted && !targetBudgetValid;
  const targetBudgetFilled = budgetAttempted && targetBudgetValid;
  
  // Acceleration: parse input
  const targetAccelAttempted = accel.trim() !== '';
  const targetAccel_mps2 = parseGValue(accel);
  const targetAccelTooSmall = isFinite(targetAccel_mps2) && targetAccel_mps2 < 0.01 * G;
  const targetAccelValid = isFinite(targetAccel_mps2) && !targetAccelTooSmall;
  const targetAccelError = targetAccelAttempted && !targetAccelValid;
  const targetAccelFilled = targetAccelAttempted && targetAccelValid;

  // Double plan switches
  const optimizeAccel = targetBudgetFilled && targetDurationFilled;
  const optimizeBudget = targetDurationFilled && targetAccelFilled;
  const optimizeDuration = targetBudgetFilled && targetAccelFilled;

  // Plan group switches
  const tripleConstraintSolving = targetBudgetFilled && targetDurationFilled && targetAccelFilled;
  const doubleConstraintSolving = optimizeAccel || optimizeBudget || optimizeDuration;
  const anyConstraintAttempted = targetDurationAttempted || budgetAttempted || targetAccelAttempted

  const noInputProvided = 
    !anyConstraintAttempted && 
    distance.trim() === "" && vrel.trim() === "" && vcrs.trim() === "" && vArrival.trim() === "" &&
    (noWakeEnabled || standoffKm.trim() === '2.5') && (flipTime.trim() == '60');

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
  const v0_mps = hasV0Error ? NaN : Math.sqrt(v0_squared) * (v0Direction === 'receding' ? -1 : 1);

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
      }[planType] ?? internalSolverError : null
  const doublePlan = doubleConstraintSolving ?
  const singlePlan = accelOnlyConstantBurnPlan ?? budgetOnlyConstantBurnPlan ?? durationOnlyConstantBurnPlan;
  const finalPlanIgnoreInputErrors = doubleConstraintSolving ? doublePlan : singlePlan;
  const finalPlanRaw = inputError ?? finalPlanIgnoreInputErrors;
  const finalPlanCanCheck = IsPlanValid(finalPlanRaw)
  const finalPlanErrors = 
    finalPlanRaw === null ? internalSolverError :
    !finalPlanCanCheck ? null :
    finalPlanRaw.a_mps2 < 0.01 * G ? computedAccelTooSlow
    : null;
  const finalPlan = noInputProvided 
    ? null 
    : (finalPlanErrors ?? finalPlanRaw);
  const finalPlanOk = IsPlanValid(finalPlan);
  const isDriftMode = finalPlanOk && finalPlan.t_drift !== 0 && finalPlan.d_drift !== 0;

  // Game time parsing
  const parsedGameTime = parseGameTime(gameStartTime);
  const gameTimeValid = parsedGameTime !== null;
  const gameTimeAttempted = gameStartTime.trim() !== '';
  const gameTimeError = gameTimeAttempted && !gameTimeValid;

  // Final Approach calculations
  const fa_distance_m =
    parseNum(faDistance) * (faDistanceUnit === 'au' ? AU : faDistanceUnit === 'gm' ? 1e9 : 1000);
  const fa_brake_distance_m = isFinite(fa_distance_m) ? fa_distance_m - standoff_m : NaN;
  const fa_v0_mps = parseNum(faVrel) * (faVrelUnit === 'km/s' ? 1000 : 1);
  const fa_v_arrival_mps =
    faVArrival.trim() === '' ? 0 : parseNum(faVArrival) * (faVArrivalUnit === 'km/s' ? 1000 : 1);

  const faTargetAccelAttempted = faAccel.trim() !== '';
  const faTargetAccel_mps2 = parseGValue(faAccel);
  const faTargetAccelTooSmall = isFinite(faTargetAccel_mps2) && faTargetAccel_mps2 < 0.01 * G
  const faTargetAccelValid = isFinite(faTargetAccel_mps2) && !faTargetAccelTooSmall
  const faTargetAccelError = faTargetAccelAttempted && !faTargetAccelValid

  // FA budget conversion - parsed same as Desired Travel Time (bare number = seconds)
  const faTargetBudgetAttempted = faBudget.trim() !== ''
  const faTargetBudget_s = parseTargetDuration(faBudget);
  const faTargetBudgetValid = faTargetBudget_s !== null;
  const faTargetBudgetError = faTargetBudgetAttempted && !faTargetBudgetValid

  const faNoInputProvided = 
    !faTargetAccelAttempted && !faTargetBudgetAttempted &&
    faDistance.trim() === '' && faVrel === '' && faVArrival.trim() === "" &&
    (noWakeEnabled || standoffKm.trim() === '2.5');

  const faMissingFields = [
    ...(!isFinite(fa_distance_m) ? ['RANGE'] : []),
    ...(!isFinite(fa_v0_mps) ? ['CLOSING VELOCITY'] : []),
    ...((!!faTargetAccelAttempted && !isFinite(faTargetAccel_mps2)) ? ['ACCELERATION'] : []),
    ...((faVArrival.trim() !== '' && !isFinite(fa_v_arrival_mps)) ? ['CUTOFF VELOCITY'] : []),
  ];

  // Stand-off error for FA (mirrors burn-mode logic)
  const fa_standoffError = !standoffValid
    ? 'invalid-standoff'
    : isFinite(fa_distance_m) && fa_distance_m <= standoff_m
      ? 'within-standoff'
      : null;
  const fa_hasWakeError = fa_standoffError !== null;

  const faInputError = 
      faMissingFields.length > 0 ? badInputError :
      faTargetAccelTooSmall ? targetAccelTooSmallError :
      fa_hasWakeError ? getStandOffError({standoffError : fa_standoffError, noWakeEnabled, standoffKm}) :
      null

  const faConstantBurnPlan = computeFinalApproach_constantBurn({ 
    distance_m: fa_brake_distance_m, 
    v0_mps : fa_v0_mps, 
    v_arrival_mps : fa_v_arrival_mps 
  });
  const faPlanBudget = faTargetBudgetValid ?
    computeFinalApproach_givenBudget({
      distance_m: fa_brake_distance_m,
      v0_mps: fa_v0_mps,
      budget_s: faTargetBudget_s,
      v_arrival_mps: fa_v_arrival_mps,
    }) : null;

  const faPlanAccel = faTargetAccelValid ? 
    computeFinalApproach_givenAccel({
      distance_m: fa_brake_distance_m,
      v0_mps: fa_v0_mps,
      a_mps2: faTargetAccel_mps2,
      v_arrival_mps: fa_v_arrival_mps,
    }) : null;

  const faPlanIgnoreInputErrors = faPlanAccel ?? faPlanBudget ?? faConstantBurnPlan
  const faPlanRaw = faInputError ?? faPlanIgnoreInputErrors
  const faPlanCanCheck = faPlanRaw.error === null && !faPlanRaw.overshoot;
  const faPlanErrors = !faPlanCanCheck ? null :
    faPlanRaw.a_mps2 < 0.01 * G ? finalApproach_computedDecelTooSlow
    : null;
  const faPlan = faNoInputProvided
    ? null
    : (faPlanErrors ?? faPlanRaw);

  // FA game clock
  const faParsedGameTime = parseGameTime(faGameStartTime);
  const faGameTimeValid = faParsedGameTime !== null;
  const faGameTimeAttempted = faGameStartTime.trim() !== '';
  const faGameTimeError = faGameTimeAttempted && !faGameTimeValid;

  const burnInputArgs = {
    distance, setDistance, distanceUnit, setDistanceUnit, 
    vrel, setVrel, vrelUnit, setVrelUnit,
    v0Direction, setV0Direction,
    vcrs, setVcrs, vcrsUnit, setVcrsUnit,
    vArrival, setVArrival, vArrivalUnit, setVArrivalUnit,
    noWakeEnabled, setNoWakeEnabled, 
    standoffKm, setStandoffKm, standoff_m, standoffError,
    accel, setAccel, targetAccelError,
    targetDuration, setTargetDuration, targetDurationError, targetDuration_s,
    reactantBudget, setReactantBudget, targetBudgetError, targetBudget_s,
    flipTime, setFlipTime, flipTimeValid, flipTimeError,
    gameStartTime, setGameStartTime, gameTimeError, gameTimeValid,
    isDriftMode, anyConstraintAttempted
  }
  const approachInputArgs = {
      faDistance, setFaDistance, faDistanceUnit, setFaDistanceUnit,
      faVrel, setFaVrel, faVrelUnit, setFaVrelUnit,
      faVArrival, setFaVArrival, faVArrivalUnit, setFaVArrivalUnit,
      faAccel, setFaAccel, faTargetAccelError,
      faBudget, setFaBudget, faTargetBudgetError, faTargetBudget_s, 
      noWakeEnabled, setNoWakeEnabled, 
      standoffKm, setStandoffKm, standoff_m, standoffError,
      faGameStartTime, setFaGameStartTime, faGameTimeError, faGameTimeValid
  }

  return (
    <>
      <BootSplash/>
      <div className="bc-root">
        <div className="bc-container">
          {/* HEADER */}
          <AppHeader appMode={appMode} finalPlan={finalPlan} faPlan={faPlan}/>

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
              input={{vcrs_mps, inputAccel_mps2: targetAccelAttempted ? targetAccel_mps2 : null, burn_distance_m, noWakeEnabled, standoff_m}}
              passthroughInputArgs={burnInputArgs}
            />)}

            {/* FINAL APPROACH results */}
            {appMode === 'approach' && (
              <ApproachOutput 
              faPlan={faPlan} 
              faParsedGameTime={faParsedGameTime} 
              input={{faTargetBudget_s, inputAccel_mps2: faTargetAccelAttempted ? faTargetAccel_mps2 : null, noWakeEnabled, standoff_m}}
              passthroughInputArgs={approachInputArgs}
            />)}
          </div>

          {/* TIMELINE + GAME-TIME TARGETS - burn mode only */}
          {appMode === 'burn' && (<Timeline finalPlan={finalPlan} parsedGameTime={parsedGameTime}/>)}
        </div>
      </div>
    </>
  );
}

