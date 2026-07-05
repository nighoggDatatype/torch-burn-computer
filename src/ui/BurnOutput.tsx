import { AlertTriangle } from "lucide-react";
import Readout from "../components/Readout.js";
import { G } from "../utils/constants.js";
import { formatDistance, formatVelocity, formatGameTime, formatTime, formatTargetDuration, addGameTime } from "../utils/formatters.js";
import { GameDateTime } from "../utils/parsers.js";
import { BurnPlanResult } from "../solvers/physics.js";
import { useEffect, useRef, useState } from "react";
import { BurnInputArgs, getBurnInputCopy } from "./BurnInput.js";

type RequiredBurnInput = {
    vcrs_mps : number, 
    inputAccel_mps2 : number | null, 
    burn_distance_m : number, 
    noWakeEnabled : boolean, 
    standoffKm : string //TODO: See about using number for standoffKm
}

function BurnOutput(
    {finalPlan, parsedGameTime, input, passthroughInputArgs} : 
    {finalPlan: BurnPlanResult | null, parsedGameTime : GameDateTime | null, input : RequiredBurnInput, passthroughInputArgs: BurnInputArgs}) {

    const finalPlanOk = finalPlan && finalPlan.error === null && !finalPlan.overshoot;
    const isDriftMode = finalPlanOk && finalPlan.t_drift !== 0 && finalPlan.d_drift !== 0;
    const a_mps2 = finalPlanOk ? finalPlan.a_mps2 : NaN;

    const {vcrs_mps, inputAccel_mps2, burn_distance_m, noWakeEnabled, standoffKm} = input;
    const targetAccelAttempted = inputAccel_mps2 !== null;
    
    const gameTimeValid = parsedGameTime !== null;

    const t_accel = finalPlanOk ? finalPlan.t_accel : NaN;
    const t_rot = finalPlanOk ? finalPlan.t_rotate : NaN;
    const t_drift = finalPlanOk ? finalPlan.t_drift : NaN;
    const t_total = finalPlanOk ? finalPlan.t_total : NaN;
    const t_flip_end = t_accel + t_rot;
    const t_brake_start = isDriftMode ? t_flip_end + t_drift : t_flip_end;

    const rotateTarget = gameTimeValid && finalPlanOk ? addGameTime(parsedGameTime, t_accel) : null;
    const driftEndTarget = gameTimeValid && isDriftMode ? addGameTime(parsedGameTime, t_brake_start) : null;
    const brakeTarget = gameTimeValid && finalPlanOk ? addGameTime(parsedGameTime, t_brake_start) : null;
    const arriveTarget = gameTimeValid && finalPlanOk ? addGameTime(parsedGameTime, t_total) : null;

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
    const vcrsNullTarget =
        vcrsNullTime !== null && gameTimeValid ? addGameTime(parsedGameTime, vcrsNullTime) : null;
    
    const [copied, setCopied] = useState(false);
    const [flickerKey, setFlickerKey] = useState(0);
    const prevPlanRef: React.RefObject<string|null> = useRef(null);
        
    // Flicker effect: trigger when plan output changes
    useEffect(() => {
    const key = JSON.stringify({
        v_max: finalPlanOk ? finalPlan.v_max : null,
        t_accel: finalPlanOk ? finalPlan.t_accel : null,
        t_total: finalPlanOk ? finalPlan.t_total : null,
        error: finalPlan !== null  ? finalPlan.error: null,
    });
    if (prevPlanRef.current !== null && prevPlanRef.current !== key) {
        setFlickerKey((k) => k + 1);
    }
    prevPlanRef.current = key;
    }, [
        finalPlanOk ? finalPlan.v_max : null,
        finalPlanOk ? finalPlan.t_accel : null,
        finalPlanOk ? finalPlan.t_total : null,
        finalPlan !== null ? finalPlan.error: null
        ]);
    
    function handleBurnCopy() {
        if (!finalPlan || finalPlan.error !== null || finalPlan.overshoot)
        {
            return;
        }
        const lines = getBurnInputCopy(passthroughInputArgs, inputAccel_mps2)
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
            `Min Reactant Budget: ${(((finalPlan.t_accel) + (finalPlan.t_brake)) / 3600).toFixed(2)}h`
        );
        navigator.clipboard.writeText(lines.join('\n')).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    }

    return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <div className="bc-panel scratch-b" aria-live="polite" aria-atomic="false">
        <div className="bc-panel-header bc-panel-header--actions">
        <span>◇ Burn Solution</span>
        {finalPlanOk && (
            <button className="bc-copy-btn" onClick={handleBurnCopy}>
            {copied ? 'COPIED' : 'COPY'}
            </button>
        )}
        </div>

        {/* finalPlan.error - suppressed when pre-flight fires or when accel-solve already showed an error */}
        {finalPlan !== null && finalPlan.error !== null && (
            <div className="bc-warning" role="alert">
            <AlertTriangle size={14} color="var(--red)" />
            <div className="bc-warning-text">
                <strong>{finalPlan.error}</strong>
                {finalPlan.detail !== null && (
                <>
                    <br />
                    {finalPlan.detail}
                </>
                )}
            </div>
            </div>
        )}

        {finalPlan !== null && finalPlan.error === null && finalPlan.overshoot && (
        <div className="bc-warning" role="alert">
            <AlertTriangle size={14} color="var(--red)" />
            <div className="bc-warning-text">
            <strong>CANNOT BRAKE IN TIME</strong>
            <br />
            {noWakeEnabled
                ? 'Ship is moving too fast to stop before the no-wake boundary.'
                : `Ship is moving too fast to stop before the stand-off boundary (${standoffKm} km).`}
            <br />
            Minimum brake distance needed:{' '}
            <strong>{formatDistance(finalPlan.brake_only_dist)}</strong>
            <br />
            Shortfall: <strong>{formatDistance(finalPlan.shortfall)}</strong>
            <br />
            Reduce current velocity, lower cutoff speed, or increase distance.
            </div>
        </div>
        )}

        {finalPlanOk && finalPlan.flip_now && (
        <div className="bc-info">
            <strong>ROTATE NOW</strong> - at or past geometric flip point. Begin rotation
            immediately.
        </div>
        )}

        {finalPlanOk && highVcrsWarning && (
        <>
            <div className="bc-advisory">
            <strong>HIGH VCRS DETECTED</strong> - Cross-track velocity is {formatVelocity(Math.abs(vcrs_mps))}. VCRS cannot be easily corrected during the burn.
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
                BURN AT {manualNullBearing} FOR THIS DURATION - THEN RE-ENTER VALUES FOR
                A FRESH BURN PLAN
                </div>
            </>
            )}
        </>
        )}

        {finalPlanOk && (
        <>
            {/* -- Computed Accel - shown when a desired accel is not provided by the user -- */}
            {!targetAccelAttempted && (
            <Readout
                label="Computed Accel"
                value={`${(finalPlan.a_mps2 / G).toFixed(2)} G`}
                highlight
                flickerKey={flickerKey}
            />
            )}
            {/* -- Section 1: Key targets -- */}
            <Readout
            label={isDriftMode ? 'End Accel / Begin Flip' : 'Begin Rotate'}
            value={
                gameTimeValid ? formatGameTime(rotateTarget) : `T+${formatTargetDuration(Math.floor(t_accel))}`
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
                    : `T+${formatTargetDuration(Math.floor(t_brake_start))}`
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
                    : `T+${formatTargetDuration(Math.floor(t_brake_start))}`
                }
                highlight
                flickerKey={flickerKey}
            />
            )}
            <Readout
            label="Arrival"
            value={
                gameTimeValid ? formatGameTime(arriveTarget) : `T+${formatTargetDuration(Math.floor(t_total))}`
            }
            highlight
            flickerKey={flickerKey}
            />
            <Readout
            label="Accel Duration"
            value={formatTargetDuration(Math.floor(t_accel))}
            highlight
            flickerKey={flickerKey}
            />
            {isDriftMode && (
            <Readout
                label="Drift Duration"
                value={formatTargetDuration(Math.floor(finalPlan.t_drift))}
                highlight
                flickerKey={flickerKey}
            />
            )}
            <Readout
            label="Brake Duration"
            value={formatTargetDuration(Math.floor(t_total) - Math.floor(t_brake_start))}
            highlight
            flickerKey={flickerKey}
            />

            {/* -- Divider -- */}
            {vcrs_drift_m >= burn_distance_m * 0.001 && (
            <div className="bc-info" style={{ marginTop: 10 }}>
                <strong>CROSS-TRACK CORRECTION APPLIED</strong> - burn distance extended
                by {formatDistance(vcrs_drift_m)} due to VCRS drift over burn
                duration.
            </div>
            )}
        </>
        )}
        {finalPlan === null && (
        <div
            style={{
            fontSize: 11,
            color: 'var(--text-dim)',
            letterSpacing: '0.08em',
            padding: '12px 0',
            }}
        >
            ENTER BURN PARAMETERS TO COMPUTE SOLUTION
        </div>
        )}
    </div>

    {/* BURN REFERENCE - right column, below Burn Solution */}
    {finalPlanOk && (
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
        <Readout
            label="Reactant Budget Used"
            value={`${Math.floor((finalPlan.t_accel + finalPlan.t_brake) / 3600)}h`}
            highlight
            flickerKey={flickerKey}
        />
        </div>
    )}
    </div>
    )
}
export default BurnOutput;