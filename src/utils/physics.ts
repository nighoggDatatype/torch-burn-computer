/**
 * Computes a flip-and-burn trajectory.
 */

export type ErrorResult = { error : string, detail: string}

export type OvershootBurnPlanResult = { error: null, overshoot: true, brake_only_dist: number, shortfall: number, t_brake_full: number }
export type SuccessBurnPlanResult = { error: null, overshoot: false, flip_now: boolean, a_mps2: number, v_max: number, t_accel: number, t_rotate: number, t_drift: number, t_brake: number, t_total: number, d_accel: number, d_rotate: number, d_drift: number, d_brake: number }
export type BurnPlanResult = ErrorResult | OvershootBurnPlanResult | SuccessBurnPlanResult

export type OvershootFinalApproachResult = { error: null, overshoot: true, d_brake_needed: number, shortfall: number, required_a: number, t_brake_if_max: number,}
export type SuccessFinalApproachResult = { error: null, overshoot: false, t_brake: number, t_coast: number, d_brake: number, d_coast: number, required_a: number, t_total: number}

type AccelResult = { error: null, a_mps2: number }

export function computeConstantBurnPlan({ distance_m, v0_mps, a_mps2, v_arrival_mps, t_rotate_s } : 
  { distance_m: number, v0_mps: number, a_mps2: number, v_arrival_mps: number, t_rotate_s: number}) : BurnPlanResult {
  if (![distance_m, v0_mps, a_mps2, v_arrival_mps, t_rotate_s].every(isFinite)) {
    return {
      error: 'MISSING OR INVALID INPUT',
      detail: 'One or more fields are empty or non-numeric.',
    };
  }
  if (a_mps2 <= 0)
    return {
      error: 'ACCELERATION MUST BE POSITIVE',
      detail: 'Enter a thrust value greater than zero.',
    };
  if (distance_m <= 0)
    return { error: 'BURN DISTANCE IS ZERO OR NEGATIVE', detail: 'Increase the total distance.' };
  if (v_arrival_mps < 0)
    return {
      error: 'CUTOFF VELOCITY CANNOT BE NEGATIVE',
      detail: 'Enter the desired speed at torch cutoff.',
    };
  if (t_rotate_s < 0)
    return {
      error: 'FLIP TIME CANNOT BE NEGATIVE',
      detail: 'Enter zero or a positive flip duration.',
    };

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
 * Computes a constant-deceleration final approach.
 */
export function computeFinalApproach({ distance_m, v0_mps, a_mps2, v_arrival_mps } :
  { distance_m: number, v0_mps: number, a_mps2: number, v_arrival_mps: number}) :
  ErrorResult | OvershootFinalApproachResult | SuccessFinalApproachResult {
  if (![distance_m, v0_mps, a_mps2, v_arrival_mps].every(isFinite)) {
    return {
      error: 'MISSING OR INVALID INPUT',
      detail: 'One or more fields are empty or non-numeric.',
    };
  }
  if (a_mps2 <= 0)
    return {
      error: 'ACCELERATION MUST BE POSITIVE',
      detail: 'Enter a thrust value greater than zero.',
    };
  if (v0_mps <= 0)
    return {
      error: 'CLOSING VELOCITY MUST BE POSITIVE',
      detail: 'Enter a positive closing speed.',
    };
  if (distance_m <= 0)
    return { error: 'RANGE IS ZERO OR NEGATIVE', detail: 'Increase the distance to target.' };
  if (v_arrival_mps < 0)
    return {
      error: 'CUTOFF VELOCITY CANNOT BE NEGATIVE',
      detail: 'Enter the desired speed at torch cutoff.',
    };
  if (v_arrival_mps >= v0_mps)
    return {
      error: 'CUTOFF VELOCITY MUST BE LESS THAN CURRENT VREL',
      detail: 'You must be braking toward a lower speed.',
    };

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
    required_a,
    t_total: t_coast + t_brake,
  };
}

/**
 * Solves for the acceleration required to complete a burn in exactly t_total_s seconds.
 *
 * Derivation: substituting v_max = (a·T + S)/2 into the distance constraint yields
 * a quadratic in a: A·a² + B·a + C = 0
 * where T = t_total_s − t_rotate_s, S = v0_mps + v_arrival_mps.
 * 
 * 
 * TODO: FIGURE OUT WHAT THE FUCK THE SOUNDNESS OF THIS ALGO IS, AND IF I NEED TO DO NUMERICAL ANALAYSIS INSTEAD
 */
export function solveAcceleration({ distance_m, v0_mps, v_arrival_mps, t_rotate_s, t_total_s } : 
  { distance_m: number, v0_mps: number, v_arrival_mps: number, t_rotate_s: number, t_total_s: number}) :
  ErrorResult | AccelResult {
  if (![distance_m, v0_mps, v_arrival_mps, t_rotate_s, t_total_s].every(isFinite)) {
    return {
      error: 'MISSING OR INVALID INPUT',
      detail: 'One or more fields are empty or non-numeric.',
    };
  }
  if (distance_m <= 0)
    return { error: 'BURN DISTANCE IS ZERO OR NEGATIVE', detail: 'Increase the total distance.' };
  if (v_arrival_mps < 0)
    return {
      error: 'CUTOFF VELOCITY CANNOT BE NEGATIVE',
      detail: 'Enter the desired speed at torch cutoff.',
    };
  if (t_total_s <= 0)
    return {
      error: 'TARGET DURATION MUST BE POSITIVE',
      detail: 'Enter a duration greater than zero.',
    };

  const T = t_total_s - t_rotate_s;
  if (T <= 0)
    return { error: 'DURATION TOO SHORT', detail: 'Target duration must exceed the flip time.' };

  const S = v0_mps + v_arrival_mps;
  const D = distance_m;

  const A_coeff = T * (T + 2 * t_rotate_s);
  const B_coeff = 2 * (S * (T + t_rotate_s) - 2 * D);
  const C_coeff = S * S - 2 * v0_mps * v0_mps - 2 * v_arrival_mps * v_arrival_mps;

  const disc = B_coeff * B_coeff - 4 * A_coeff * C_coeff;
  if (disc < 0)
    return {
      error: 'NO SOLUTION EXISTS',
      detail: 'The target duration is physically impossible for this distance and velocity.',
    };

  const r1 = (-B_coeff + Math.sqrt(disc)) / (2 * A_coeff);
  const r2 = (-B_coeff - Math.sqrt(disc)) / (2 * A_coeff);

  const candidates = [r1, r2].filter((r) => r > 1e-6); // must be meaningfully positive
  if (candidates.length === 0)
    return {
      error: 'NO POSITIVE SOLUTION',
      detail: 'The target duration is too long — no valid acceleration found.',
    };

  const a = Math.min(...candidates); // smallest positive root = minimum required acceleration
  return { a_mps2: a, error : null};
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
