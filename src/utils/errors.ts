import { formatTargetDuration } from "./formatters.js"

export type ErrorResult = { error : string, detail: string | null}


// Generic input error

export const badInputError = { 
    error : "MISSING OR INVALID INPUT", 
    detail : "One or more fields are empty or non-numeric."
}

//Single input error

export const targetAccelTooSmallError = {
    error: "ACCELERATION BELOW MINIMUM THRUST (0.01 G)",
    detail: "Enter a value of 0.01 G or higher."
}
export const nonPositiveAccelError = {
    error: 'ACCELERATION MUST BE POSITIVE',
    detail: 'Enter a thrust value greater than zero.',
}
export const negativeFlipTimeError = {
    error: 'FLIP TIME CANNOT BE NEGATIVE',
    detail: 'Enter zero or a positive flip duration.',
}
export const negativeArrivalVelocityError = { 
    error: 'CUTOFF VELOCITY CANNOT BE NEGATIVE', 
    detail: 'Enter the desired approach speed at torch cutoff.' 
}
export const nonPositiveDurationError = {
    error: 'TARGET DURATION MUST BE POSITIVE',
    detail: 'Enter a duration greater than zero.',
}

//Multi input error

export const nonPositiveBurnDistanceError = { 
    error: 'BURN DISTANCE IS ZERO OR NEGATIVE', 
    detail: 'Increase the total distance.' 
}
export const flipTimeGreaterThanDurationError = { 
    error: 'TARGET DURATION TOO SHORT', 
    detail: 'Target duration must exceed the flip time.' 
};

export function getV0Error
(
    {vcrs_mps} : {vcrs_mps : number}
)
{
    return { 
        error : "VREL CANNOT BE SMALLER THAN VCRS", 
        detail : `VREL must be greater than ${Math.abs(vcrs_mps)}`
    }
}
export function getStandOffError
(
    {standoffError, noWakeEnabled, standoffKm} : {standoffError : string | null, noWakeEnabled : boolean, standoffKm : string}
) : ErrorResult {
    return standoffError === 'invalid-standoff'
        ? { error: 'INVALID STAND-OFF DISTANCE', detail: 'Enter a positive distance in km.' }
        : noWakeEnabled
            ? {
                error: 'DESTINATION IS WITHIN THE 300 KM NO-WAKE ZONE',
                detail: 'You are already inside the no-wake boundary.',
              }
            : {
                error: `DESTINATION IS WITHIN THE STAND-OFF ZONE (${standoffKm} KM)`,
                detail: 'Increase total range or reduce the stand-off distance.',
              }
}

//Burn solver errors

export function impossibleBudgetOptimizeError
(
    {targetDuration_s, requiredDuration_s} : {targetDuration_s : number, requiredDuration_s : number}
) : ErrorResult {
    const targetDuration = formatTargetDuration(targetDuration_s);
    const requireDuration = formatTargetDuration(requiredDuration_s);
    return {
        error : "TARGET DURATION IMPOSSIBLE",
        detail : `Minimum duration for this burn is ${requireDuration}; target duration is ${targetDuration}.`
    }
}
export function impossibleDurationOptimizeError
(
    {targetBudget_s, requiredBudget_s} : {targetBudget_s : number, requiredBudget_s : number}
) : ErrorResult {
    const requiredBudget = formatTargetDuration(Math.floor(requiredBudget_s));
    const targetBudget = formatTargetDuration(Math.floor(targetBudget_s));
    return {
        error : "REACTANT BUDGET INSUFFICIENT", 
        detail : `This burn requires at least ${requiredBudget} of reactant; current budget is ${targetBudget}.`
    }
}

//Final approach specific errors

export const finalApproach_negativeInitialVelocityError = {
    error: 'CLOSING VELOCITY MUST BE POSITIVE',
    detail: 'Enter a positive closing speed.',
}
export const finalApproach_nonBrakingVelocityDeltaError = {
    error: 'CUTOFF VELOCITY MUST BE LESS THAN CURRENT VREL',
    detail: 'You must be braking toward a lower speed.',
}