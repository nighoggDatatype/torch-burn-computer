import { insufficientDurationError, insufficientBudgetError, nonPositiveAccelError } from "../utils/errors.js";
import { buildDriftPlan, BurnPlanResult, computeConstantBurnPlan, solveAcceleration } from "./physics.js";

export function accelOnlySolver( 
    {burn_distance_m, v0_mps, targetAccel_mps2, v_arrival_mps, t_rotate_s} :
    {burn_distance_m : number, v0_mps : number, targetAccel_mps2 : number, v_arrival_mps : number, t_rotate_s : number}
) : BurnPlanResult {
    return computeConstantBurnPlan({ distance_m: burn_distance_m, v0_mps, a_mps2: targetAccel_mps2, v_arrival_mps, t_rotate_s })
}
export function budgetOnlySolver
(
    {burn_distance_m, v0_mps, targetBudget_s, v_arrival_mps, t_rotate_s}:
    {burn_distance_m : number, v0_mps : number, targetBudget_s : number, v_arrival_mps : number, t_rotate_s : number}
) : BurnPlanResult {
    const solveT_s =  targetBudget_s + t_rotate_s;

    const accelSolveResult = solveAcceleration({distance_m: burn_distance_m, v0_mps, v_arrival_mps, t_rotate_s, t_total_s: solveT_s});
    if (accelSolveResult.error !== null)
    {
      return accelSolveResult;
    }

    return computeConstantBurnPlan({ distance_m: burn_distance_m, v0_mps, a_mps2: accelSolveResult.a_mps2, v_arrival_mps, t_rotate_s })
}
export function durationOnlySolver(
    {burn_distance_m, v0_mps, targetDuration_s, v_arrival_mps, t_rotate_s} :
    {burn_distance_m : number, v0_mps : number, targetDuration_s : number, v_arrival_mps : number, t_rotate_s : number}
) : BurnPlanResult {
    const accelSolveResult = solveAcceleration({distance_m: burn_distance_m, v0_mps, v_arrival_mps, t_rotate_s, t_total_s: targetDuration_s});
    if (accelSolveResult.error !== null)
    {
      return accelSolveResult;
    }

    return  computeConstantBurnPlan({ distance_m: burn_distance_m, v0_mps, a_mps2: accelSolveResult.a_mps2, v_arrival_mps, t_rotate_s })
}
export function optimalBudgetSolver(
    {
    accelOnlyConstantBurnPlan, durationOnlyConstantBurnPlan,
    burn_distance_m, v0_mps, v_arrival_mps, t_rotate_s,
    targetDuration_s, targetAccel_mps2
    } : {
    accelOnlyConstantBurnPlan : BurnPlanResult | null,
    durationOnlyConstantBurnPlan : BurnPlanResult | null,
    burn_distance_m : number, v0_mps : number, v_arrival_mps : number, t_rotate_s : number,
    targetDuration_s : number, targetAccel_mps2 : number
    }
) : BurnPlanResult | null
{
    if (accelOnlyConstantBurnPlan === null)
    {
        return null;
    }
    if (accelOnlyConstantBurnPlan.error !== null || accelOnlyConstantBurnPlan.overshoot)
    {
        return accelOnlyConstantBurnPlan;
    }
    const a_mps2 = targetAccel_mps2;
    if (!isFinite(a_mps2))
    {
        return null; //Caught at an earlier stage, supressing this plan
    }
    if (a_mps2 <= 0)
    {
        return nonPositiveAccelError;
    }
    const constantBurn_v_max = accelOnlyConstantBurnPlan.v_max;
    if(durationOnlyConstantBurnPlan === null)
    {
        return null;
    }
    if (durationOnlyConstantBurnPlan.error !== null || durationOnlyConstantBurnPlan.overshoot)
    {
        return durationOnlyConstantBurnPlan;
    }

    //Kinamatic equations will eventually give you m^2 - Pm + Q = 0 as below, so the equations below is just implementing the quadratic equation.
    //P is fliped to negative for ease of computation
    const P = v0_mps + v_arrival_mps + a_mps2 * targetDuration_s;
    const Q = a_mps2 * burn_distance_m + (v0_mps * v0_mps + v_arrival_mps * v_arrival_mps) / 2;
    const disc = P * P - 4 * Q;

    if (disc >= 0) {
        const v_max_small_root = (P - Math.sqrt(disc)) / 2; // attempt smaller root first
        if (v_max_small_root > v0_mps && v_max_small_root > v_arrival_mps && v_max_small_root < constantBurn_v_max) {
        const plan = buildDriftPlan({ distance_m: burn_distance_m, v0_mps, a_mps2, v_arrival_mps, t_rotate_s, v_max: v_max_small_root });
        if (plan !== null) 
        {
            return plan;
        }
        }
        const v_max_large_root = (P + Math.sqrt(disc)) / 2; // try larger root next (Note: Not sure about what this means physically, just hope this is sensible)
        if (v_max_large_root > v0_mps && v_max_large_root > v_arrival_mps && v_max_large_root < constantBurn_v_max) {
        return buildDriftPlan({ distance_m: burn_distance_m, v0_mps, a_mps2, v_arrival_mps, t_rotate_s, v_max: v_max_large_root });
        }
        return null
    }
    return insufficientDurationError({targetDuration_s, requiredDuration_s : accelOnlyConstantBurnPlan.t_total})
}
export function optimalDurationSolver(
    {
    budgetOnlyConstantBurnPlan, accelOnlyConstantBurnPlan,
    burn_distance_m, v0_mps, v_arrival_mps, t_rotate_s,
    targetAccel_mps2, targetBudget_s
    } : {
    budgetOnlyConstantBurnPlan : BurnPlanResult | null,
    accelOnlyConstantBurnPlan : BurnPlanResult | null,
    burn_distance_m : number, v0_mps : number, v_arrival_mps : number, t_rotate_s : number,
    targetAccel_mps2 : number, targetBudget_s : number
    }
) : BurnPlanResult | null
{
    if (accelOnlyConstantBurnPlan === null)
    {
      return null;
    }
    if (accelOnlyConstantBurnPlan.error !== null || accelOnlyConstantBurnPlan.overshoot)
    {
      return accelOnlyConstantBurnPlan;
    }
    if (budgetOnlyConstantBurnPlan === null)
    {
      return null;
    }
    if (budgetOnlyConstantBurnPlan.error !== null || budgetOnlyConstantBurnPlan.overshoot)
    {
      return budgetOnlyConstantBurnPlan;
    }
    const a_mps2 = targetAccel_mps2;
    if (!isFinite(a_mps2) || a_mps2 <= 0)
    {
      return null;
    }
    const v_max_budget = (a_mps2 * targetBudget_s + v0_mps + v_arrival_mps) / 2;

    if (v_max_budget <= v0_mps || v_max_budget <= v_arrival_mps) {
        const requiredDeltaV_mps = Math.abs(v_arrival_mps - v0_mps)
        const requiredBudget_s = requiredDeltaV_mps / a_mps2;
        return insufficientBudgetError({requiredBudget_s, targetBudget_s})
    } else {
        const driftPlan = buildDriftPlan({ distance_m: burn_distance_m, v0_mps, a_mps2, v_arrival_mps, t_rotate_s, v_max: v_max_budget });
        if (driftPlan !== null)
        {
            return driftPlan
        }
        else //Excess budget, go back to accelOnly
        {
            return accelOnlyConstantBurnPlan;
        }
    }
}
export function optimalAccelSolver(
    {
    budgetOnlyConstantBurnPlan, durationOnlyConstantBurnPlan,
    burn_distance_m, v0_mps, v_arrival_mps, t_rotate_s,
    targetDuration_s, targetBudget_s
    } : {
    budgetOnlyConstantBurnPlan : BurnPlanResult | null,
    durationOnlyConstantBurnPlan : BurnPlanResult | null,
    burn_distance_m : number, v0_mps : number, v_arrival_mps : number, t_rotate_s : number,
    targetDuration_s : number, targetBudget_s : number
    }
) : BurnPlanResult | null
{
    //Extract budgetOnly extrema data
    if(budgetOnlyConstantBurnPlan === null)
    {
      return null;
    }
    if (budgetOnlyConstantBurnPlan.error !== null || budgetOnlyConstantBurnPlan.overshoot)
    {
      return budgetOnlyConstantBurnPlan;
    }
    let max_a_mps2 = budgetOnlyConstantBurnPlan.a_mps2;

    //Extract durationOnly extrema data
    if(durationOnlyConstantBurnPlan === null)
    {
      return null;
    }
    if (durationOnlyConstantBurnPlan.error !== null || durationOnlyConstantBurnPlan.overshoot)
    {
      return durationOnlyConstantBurnPlan;
    }
    let min_a_mps2 = durationOnlyConstantBurnPlan.a_mps2
    if (min_a_mps2 >= max_a_mps2) //budgetOnly no longer satisfies duration requriements, but durationOnly still would satisfy budget in excess
    {
      return durationOnlyConstantBurnPlan;
    }
    let bestDriftPlan = budgetOnlyConstantBurnPlan;
    for (let i = 0; i < 30; i++)
    {
      const a_mps2 = (max_a_mps2 + min_a_mps2) / 2
      const v_max = (a_mps2 * targetBudget_s + v0_mps + v_arrival_mps) / 2;
      if (v_max <= v0_mps || v_max <= v_arrival_mps) { // v_max too small => a_mps2 too small => increase min_a_mps2
        min_a_mps2 = a_mps2;
        continue;
      }
      const candiateDriftPlan = buildDriftPlan({ distance_m: burn_distance_m, v0_mps, a_mps2, v_arrival_mps, t_rotate_s, v_max })
      if (candiateDriftPlan === null) { //v_max too high, reduce
        max_a_mps2 = a_mps2;
        continue;
      }
      const candidate_duration = candiateDriftPlan.t_total;
      if (candidate_duration > targetDuration_s + 1) //Too slow, faster acceleration (allow 1 second leeway for display purposes)
      {
        min_a_mps2 = a_mps2;
        continue
      }
      //Candidate plan is now valid, bisection guarantees it has lower a_mps2 so we use it as new best value
      bestDriftPlan = candiateDriftPlan; 
      if (targetDuration_s - Math.floor(candidate_duration) < 1) //Display duration will be the same
      {
        break; //Early exit for performance
      }
      max_a_mps2 = a_mps2;
      //Implicit continue
    }
    return bestDriftPlan;
}