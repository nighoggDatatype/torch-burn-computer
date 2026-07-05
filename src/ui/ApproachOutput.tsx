import { AlertTriangle } from "lucide-react";
import Readout from "../components/Readout.js";
import { FinalApproachResult } from "../solvers/approachSolvers.js";
import { G } from "../utils/constants.js";
import { addGameTime, formatDistance, formatTargetDuration, formatGameTime } from "../utils/formatters.js";
import { GameDateTime } from "../utils/parsers.js";
import { ApproachInputArgs, getApproachInputCopy } from "./ApproachInput.js";
import { useEffect, useRef, useState } from "react";

type RequiredApproachInput = {
    faTargetBudget_s : number | null,
    inputAccel_mps2 : number | null,
    noWakeEnabled : string, 
    standoff_m : number 
}

function ApproachOutput(
    {faPlan, faParsedGameTime, input, passthroughInputArgs} : 
    {
        faPlan: FinalApproachResult | null, faParsedGameTime : GameDateTime | null, input : RequiredApproachInput, passthroughInputArgs: ApproachInputArgs
    }) {

    const faPlanOk = faPlan !== null && faPlan.error === null && !faPlan.overshoot;

    const {faTargetBudget_s, inputAccel_mps2, noWakeEnabled, standoff_m} = input;
    const faTargetBudgetValid = faTargetBudget_s !== null;
    const targetAccelAttempted = inputAccel_mps2 !== null;

    const faGameTimeValid = faParsedGameTime !== null;
    const faBrakeTarget =
    faGameTimeValid && faPlanOk ? addGameTime(faParsedGameTime, faPlan.t_coast) : null;
    const faArriveTarget =
    faGameTimeValid && faPlanOk ? addGameTime(faParsedGameTime, faPlan.t_total) : null;
    
    const [copied, setCopied] = useState(false);
    const [flickerKey, setFlickerKey] = useState(0);
      const prevPlanRef: React.RefObject<string|null> = useRef(null);
    useEffect(() => {
        const key = JSON.stringify({
        a_mps2: faPlanOk ? faPlan.a_mps2 : null,
        t_accel: faPlanOk ? faPlan.t_brake : null,
        t_total: faPlanOk ? faPlan.t_total : null,
        error: faPlan !== null ? faPlan.error : null,
        });
        if (prevPlanRef.current !== null && prevPlanRef.current !== key) {
        setFlickerKey((k) => k + 1);
        }
        prevPlanRef.current = key;
    }, [
            faPlanOk ? faPlan.a_mps2 : null,
            faPlanOk ? faPlan.t_brake : null,
            faPlanOk ? faPlan.t_total : null,
            faPlan !== null ? faPlan.error : null
        ]);
        
    function handleFaCopy() { //TODO: Double check all copy text is valid
        if (!faPlan || faPlan.error !== null || faPlan.overshoot)
        {
        return;
        }
        const lines = getApproachInputCopy(passthroughInputArgs, inputAccel_mps2)
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
    return (
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

            {faPlan !== null && faPlan.error !== null && (
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

            {faPlan !== null  && faPlan.error === null && faPlan.overshoot && (
            <div className="bc-warning" role="alert">
                <AlertTriangle size={14} color="var(--red)" />
                <div className="bc-warning-text">
                <strong>CANNOT BRAKE IN TIME - OVERSHOOT IMMINENT</strong>
                <br />
                {noWakeEnabled === 'enabled'
                    ? 'Ship is moving too fast to stop before the no-wake boundary.'
                    : `Ship is moving too fast to stop before the stand-off boundary (${Math.round(standoff_m)/1000} km).`}
                <br />
                Minimum brake distance needed: <strong>{formatDistance(faPlan.d_brake_needed)}</strong>
                <br />
                Shortfall: <strong>{formatDistance(faPlan.shortfall)}</strong>
                <br />
                {targetAccelAttempted && (
                <>
                    Required deceleration: <strong> {(faPlan.required_a / G).toFixed(2) + ' G'}</strong>
                    <br />
                    Avaliable deceleration: {(inputAccel_mps2 / G).toFixed(2) + ' G'}
                    <br />
                </>
                )}
                The solver cannot recover this approach. Enact evasive burn if possible or brace.
                </div>
            </div>
            )}

            {faPlanOk && (
            <>
                {/* Constant burn aleart */}
                {(faPlan.d_coast === 0 && faPlan.t_coast === 0) && (
                    <div className="bc-fa-advisory">● CONSTANT BURN ENABLED: IMMEDIATE BRAKING REQUIRED</div> 
                )}

                {/* Reactant sufficiency warning */}
                {faTargetBudgetValid && (
                    <div className={faTargetBudget_s >= faPlan.t_brake ? 'bc-fa-ok' : 'bc-fa-warn'}>
                        {faTargetBudget_s >= faPlan.t_brake
                        ? `● REACTANT SUFFICIENT - BRAKE REQUIRES ${formatTargetDuration(Math.floor(faPlan.t_brake))}, BUDGET IS ${formatTargetDuration(Math.floor(faTargetBudget_s))}`
                        : `⚠ REACTANT DEFICIT - BRAKE REQUIRES ${formatTargetDuration(Math.floor(faPlan.t_brake))}, BUDGET IS ONLY ${formatTargetDuration(Math.floor(faTargetBudget_s))}`}
                    </div>
                )}

                {!targetAccelAttempted && (
                <Readout
                    label="Computed Accel"
                    value={`${(faPlan.a_mps2 / G).toFixed(2)} G`}
                    highlight
                    flickerKey={flickerKey}
                />
                )}
                {faPlan.t_coast > 1 && (
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
                    value={formatTargetDuration(Math.floor(faPlan.t_coast))}
                    highlight
                    flickerKey={flickerKey}
                />
                )}
                <Readout
                label="Brake Duration"
                value={formatTargetDuration(Math.floor(faPlan.t_brake))}
                highlight
                flickerKey={flickerKey}
                />
            </>
            )}

            {faPlan === null  && (
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
        

        {/* APPROACH REFERENCE - right column, below Approach Solution */}
        {faPlanOk && (
            <div className="bc-panel scratch-b">
            <div className="bc-panel-header">◇ Approach Reference</div>
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
            <Readout
            label="Reactant Budget Used"
            value={`${Math.floor(faPlan.t_brake / 3600)}h`}
            highlight
            flickerKey={flickerKey}
            />
            </div>
        )}
        </div>
    )
}
export default ApproachOutput;