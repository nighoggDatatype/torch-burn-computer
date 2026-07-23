/**
 * Computes a flip-and-burn trajectory.
 */

import { G } from "../utils/constants.js";
import { badInputError, computedAccelTooFast, ErrorResult, flipTimeGreaterThanDurationError, negativeArrivalVelocityError, negativeFlipTimeError, nonPositiveAccelError, nonPositiveBurnDistanceError, nonPositiveDurationError } from "../utils/errors.js"


export type OvershootBurnPlanResult = { error: null, overshoot: true, brake_only_dist: number, shortfall: number, t_brake_full: number }
export type SuccessBurnPlanResult = { error: null, overshoot: false, flip_now: boolean, a_mps2: number, v_max: number, t_accel: number, t_rotate: number, t_drift: number, t_brake: number, t_total: number, d_accel: number, d_rotate: number, d_drift: number, d_brake: number }
export type BurnPlanResult = ErrorResult | OvershootBurnPlanResult | SuccessBurnPlanResult

export function computeConstantBurnPlan({ distance_m, v0_mps, a_mps2, v_arrival_mps, t_rotate_s } : 
  { distance_m: number, v0_mps: number, a_mps2: number, v_arrival_mps: number, t_rotate_s: number}) : BurnPlanResult {
  if (![distance_m, v0_mps, a_mps2, v_arrival_mps, t_rotate_s].every(isFinite)) {
    return badInputError;
  }
  if (a_mps2 <= 0){
    return nonPositiveAccelError;
  }
  if (distance_m <= 0) {
    return nonPositiveBurnDistanceError;
  }
  if (v_arrival_mps < 0) {
    return negativeArrivalVelocityError;
  }
  if (t_rotate_s < 0) {
    return negativeFlipTimeError;
  }

  // Overshoot is only possible when current speed already exceeds the desired arrival
  // speed (v0 > v_arrival) — that's the only regime where "brake only, no extra accel"
  // is a meaningful maneuver. When v0 <= v_arrival (always true for receding ships,
  // since v0 < 0 <= v_arrival), the ship needs to accelerate, not brake, and the
  // quadratic solve below handles that correctly.
  const brake_only_dist =
    v0_mps * t_rotate_s + (v0_mps * v0_mps - v_arrival_mps * v_arrival_mps) / (2 * a_mps2);

  if (v0_mps > v_arrival_mps && brake_only_dist > distance_m + 1e-6) {
    return {
      error: null,
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
      error: null,
      overshoot: false,
      flip_now: true,
      a_mps2,
      v_max: v0_mps,
      t_accel: 0,
      t_rotate: t_rotate_s,
      t_drift: 0,
      t_brake,
      t_total: t_rotate_s + t_brake,
      d_accel: 0,
      d_rotate: v0_mps * t_rotate_s,
      d_drift: 0,
      d_brake: (v0_mps * v0_mps - v_arrival_mps * v_arrival_mps) / (2 * a_mps2),
    };
  }

  const t_accel = (v_max - v0_mps) / a_mps2;
  const t_brake = (v_max - v_arrival_mps) / a_mps2;
  return {
    error: null,
    overshoot: false,
    flip_now: false,
    v_max,
    a_mps2,
    t_accel,
    t_rotate: t_rotate_s,
    t_drift: 0,
    t_brake,
    t_total: t_accel + t_rotate_s + t_brake,
    d_accel: (v_max * v_max - v0_mps * v0_mps) / (2 * a_mps2),
    d_rotate: v_max * t_rotate_s,
    d_drift: 0,
    d_brake: (v_max * v_max - v_arrival_mps * v_arrival_mps) / (2 * a_mps2),
  };
}


/**
 * Solves for the acceleration required to complete a burn in exactly t_total_s seconds.
 * 
 * Uses the bisection method as a known good method to do so. //TODO: Validate my new method
 */
export function solveConstantBurnFromDuration({ distance_m, v0_mps, v_arrival_mps, t_rotate_s, t_total_s } : 
  { distance_m: number, v0_mps: number, v_arrival_mps: number, t_rotate_s: number, t_total_s: number}) :
  ErrorResult | SuccessBurnPlanResult {
  if (![distance_m, v0_mps, v_arrival_mps, t_rotate_s, t_total_s].every(isFinite)) {
    return badInputError;
  }
  if (distance_m <= 0) {
    return nonPositiveBurnDistanceError;
  }
  if (v_arrival_mps < 0) {
    return negativeArrivalVelocityError;
  }
  if (t_total_s <= 0) {
    return nonPositiveDurationError;
  }
  if (t_rotate_s < 0) {
    return negativeFlipTimeError;
  }
  if (t_total_s <= t_rotate_s) {
    return flipTimeGreaterThanDurationError;
  }
  // Accel scan range, set to be beyond the (0.01 - 100) range to allow natural detection of bad accel values by later steps
  let min_a_mps2 = 0.001 * G;
  let max_a_mps2 = 101 * G;
  let bestBurnPlan = null;
  for (let i = 0; i < 30; i++)
  {
    const a_mps2 = (max_a_mps2 + min_a_mps2) / 2
    const candidatePlan = computeConstantBurnPlan({ distance_m, v0_mps, a_mps2, v_arrival_mps, t_rotate_s })
    if (candidatePlan.error !== null) { //Bubble up error, only occur on bad input
      return candidatePlan;
    }
    if (candidatePlan.overshoot) { //Not enough accel, more needed
      min_a_mps2 = a_mps2;
      continue;
    }
    const candidate_duration = candidatePlan.t_total;
    if (candidate_duration > t_total_s + 1) //Too slow, faster acceleration (allow 1 second leeway for display purposes)
    {
      min_a_mps2 = a_mps2;
      continue
    }
    //Candidate plan is now valid, bisection guarantees it has lower a_mps2 so we use it as new best value
    bestBurnPlan = candidatePlan; 
    if (t_total_s - Math.floor(candidate_duration) < 1) //Display duration will be the same
    {
      break; //Early exit for performance
    }
    max_a_mps2 = a_mps2;
    //Implicit continue
  }
  if (bestBurnPlan == null) //We never found a fast enough accel, so the required accel is for sure too much
  {
    return computedAccelTooFast;
  }
  return bestBurnPlan;
}

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
export function buildDriftPlan(
  { distance_m, v0_mps, a_mps2, v_arrival_mps, t_rotate_s, v_max } : 
  { distance_m: number, v0_mps: number, a_mps2: number, v_arrival_mps: number, t_rotate_s: number, v_max: number })
  : null | SuccessBurnPlanResult {
  const t_accel = (v_max - v0_mps) / a_mps2;
  const t_brake = (v_max - v_arrival_mps) / a_mps2;
  const d_accel = (v_max * v_max - v0_mps * v0_mps) / (2 * a_mps2);
  const d_decel = (v_max * v_max - v_arrival_mps * v_arrival_mps) / (2 * a_mps2);
  const d_rotate = v_max * t_rotate_s;
  const d_drift = distance_m - d_accel - d_rotate - d_decel;
  if (d_drift < -1) return null; // no room for a drift phase at this v_max
  const t_drift = Math.max(0, d_drift / v_max);
  return {
    error: null,
    overshoot: false,
    flip_now: false,
    v_max,
    a_mps2,
    t_accel: t_accel,
    t_rotate: t_rotate_s,
    t_drift: t_drift,
    t_brake: t_brake,
    t_total: t_accel + t_rotate_s + t_drift + t_brake,
    d_accel: d_accel,
    d_rotate,
    d_drift: Math.max(0, d_drift),
    d_brake: d_decel,
  };
}

export function IsPlanValid(
  plan : null | {error : string} | {error : null, overshoot : true} | {error : null, overshoot : false}
)
{
  return plan !== null && plan.error === null && !plan.overshoot
}