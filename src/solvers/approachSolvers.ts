import { badInputError, ErrorResult, finalApproach_negativeInitialVelocityError, finalApproach_nonBrakingVelocityDeltaError, negativeArrivalVelocityError, nonPositiveAccelError, nonPositiveBudgetError, nonPositiveBurnDistanceError } from "../utils/errors.js";

export type OvershootFinalApproachResult = { error: null, overshoot: true, d_brake_needed: number, shortfall: number, required_a: number, t_brake_if_max: number,}
export type SuccessFinalApproachResult = { error: null, overshoot: false, t_brake: number, t_coast: number, d_brake: number, d_coast: number, a_mps2: number, t_total: number}
export type FinalApproachResult = ErrorResult | OvershootFinalApproachResult | SuccessFinalApproachResult
export function computeFinalApproach_constantBurn({ distance_m, v0_mps, v_arrival_mps } :
  { distance_m: number, v0_mps: number, v_arrival_mps: number}) :
  ErrorResult | SuccessFinalApproachResult {
  if (![distance_m, v0_mps, v_arrival_mps].every(isFinite)) {
    return badInputError;
  }
  if (v0_mps <= 0){
    return finalApproach_negativeInitialVelocityError;
  }
  if (distance_m <= 0) {
    return nonPositiveBurnDistanceError;
  }
  if (v_arrival_mps < 0) {
    return negativeArrivalVelocityError
  };
  if (v_arrival_mps >= v0_mps) {
    return finalApproach_nonBrakingVelocityDeltaError;
  }

  const a_mps2 = (v0_mps * v0_mps - v_arrival_mps * v_arrival_mps) / (2 * distance_m);
  const t_brake = (v0_mps - v_arrival_mps) / a_mps2;

  return {
    error: null,
    overshoot: false,
    t_brake,
    t_coast: 0,
    d_brake: distance_m,
    d_coast: 0,
    a_mps2,
    t_total: t_brake,
  };
}
export function computeFinalApproach_givenAccel({ distance_m, v0_mps, a_mps2, v_arrival_mps } :
  { distance_m: number, v0_mps: number, a_mps2: number, v_arrival_mps: number}) :
  FinalApproachResult {
  if (![distance_m, v0_mps, a_mps2, v_arrival_mps].every(isFinite)) {
    return badInputError;
  }
  if (v0_mps <= 0){
    return finalApproach_negativeInitialVelocityError;
  }
  if (distance_m <= 0) {
    return nonPositiveBurnDistanceError;
  }
  if (v_arrival_mps < 0) {
    return negativeArrivalVelocityError
  };
  if (v_arrival_mps >= v0_mps) {
    return finalApproach_nonBrakingVelocityDeltaError;
  }
  if (a_mps2 <= 0){
    return nonPositiveAccelError;
  }

  const d_brake_max = (v0_mps * v0_mps - v_arrival_mps * v_arrival_mps) / (2 * a_mps2);
  const t_brake_max = (v0_mps - v_arrival_mps) / a_mps2;
  const required_a = (v0_mps * v0_mps - v_arrival_mps * v_arrival_mps) / (2 * distance_m);

  if (d_brake_max > distance_m + 1e-6) {
    return {
      error: null,
      overshoot: true,
      d_brake_needed: d_brake_max,
      shortfall: d_brake_max - distance_m,
      required_a,
      t_brake_if_max: t_brake_max,
    };
  }

  const t_brake = t_brake_max;
  const d_coast = distance_m - d_brake_max;
  const t_coast = d_coast / v0_mps;

  return {
    error: null,
    overshoot: false,
    t_brake,
    t_coast,
    d_brake: d_brake_max,
    d_coast,
    a_mps2,
    t_total: t_coast + t_brake,
  };
}
export function computeFinalApproach_givenBudget({ distance_m, v0_mps, budget_s, v_arrival_mps } :
  { distance_m: number, v0_mps: number, budget_s: number, v_arrival_mps: number}) :
  FinalApproachResult {
  if (![distance_m, v0_mps, budget_s, v_arrival_mps].every(isFinite)) {
    return badInputError;
  }
  if (v0_mps <= 0){
    return finalApproach_negativeInitialVelocityError;
  }
  if (distance_m <= 0) {
    return nonPositiveBurnDistanceError;
  }
  if (v_arrival_mps < 0) {
    return negativeArrivalVelocityError
  };
  if (v_arrival_mps >= v0_mps) {
    return finalApproach_nonBrakingVelocityDeltaError;
  }
  if (budget_s <= 0){
    return nonPositiveBudgetError;
  }
  const a_mps2 = (v0_mps - v_arrival_mps) / budget_s;
  const required_a = (v0_mps * v0_mps - v_arrival_mps * v_arrival_mps) / (2 * distance_m);
  if (a_mps2 <= required_a)
  {
    return computeFinalApproach_constantBurn({ distance_m, v0_mps, v_arrival_mps });
  }
  
  const d_brake = (v0_mps * v0_mps - v_arrival_mps * v_arrival_mps) / (2 * a_mps2);
  const d_coast = distance_m - d_brake;
  const t_coast = d_coast / v0_mps;
  return {
    error: null,
    overshoot: false,
    t_brake : budget_s,
    t_coast,
    d_brake,
    d_coast,
    a_mps2,
    t_total: t_coast + budget_s,
  };
}