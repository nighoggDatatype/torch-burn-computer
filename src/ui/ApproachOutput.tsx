import { AlertTriangle } from "lucide-react";
import Readout from "../components/Readout.js";
import { FinalApproachResult } from "../solvers/approachSolvers.js";
import { G } from "../utils/constants.js";
import { addGameTime, formatDistance, formatTargetDuration, formatGameTime } from "../utils/formatters.js";
import { GameDateTime, parseNum } from "../utils/parsers.js";
import { ApproachInputArgs } from "./ApproachInput.js";
import { useEffect, useRef, useState } from "react";
import { IsPlanValid } from "../solvers/physics.js";

type RequiredApproachInput = {
    faTargetBudget_s : number | null,
    faTargetAccel_mps2 : number,
    faAccelComputed : boolean,
    faPlanType : string | null
    standoff_m : number,
    noWakeEnabled : string, 
}

function ApproachOutput(
    {faPlan, faParsedGameTime, input, approachInputSummaryArgs} : 
    {
        faPlan: FinalApproachResult | null, faParsedGameTime : GameDateTime | null, input : RequiredApproachInput, approachInputSummaryArgs: ApproachInputSummaryArgs
    }) {

    const faPlanOk = IsPlanValid(faPlan) 

    const {faTargetBudget_s, faTargetAccel_mps2, faAccelComputed, faPlanType, noWakeEnabled, standoff_m} = input;

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
    }, [faPlanOk, faPlan]);
        
    function handleFaCopy() { //TODO: Double check all copy text is valid
        if (!faPlan || faPlan.error !== null || faPlan.overshoot)
        {
        return;
        }
        const lines = getApproachInputCopy(approachInputSummaryArgs)
        lines.push('');
        lines.push('-- APPROACH SOLUTION --'); //TODO: Add computed accel display
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
                {isFinite(faTargetAccel_mps2) && (
                <>
                    Required deceleration: <strong> {(faPlan.required_a / G).toFixed(2) + ' G'}</strong>
                    <br />
                    Avaliable deceleration: {(faTargetAccel_mps2 / G).toFixed(2) + ' G'}
                    <br />
                </>
                )}
                The solver cannot recover this approach. Enact evasive burn if possible or brace.
                </div>
            </div>
            )}

            {faPlanOk && (
            <>
                {/* Misc info */}
                {(faPlan.d_coast === 0 && faPlan.t_coast === 0) && (
                    <div className="bc-fa-advisory">● CONSTANT BURN ENABLED: IMMEDIATE BRAKING REQUIRED</div> 
                )}
                {faPlanType == 'budget' && faTargetBudget_s !== null && (
                    <div className='bc-fa-ok'>
                        ● REACTANT SUFFICIENT - BRAKE REQUIRES ${formatTargetDuration(Math.floor(faPlan.t_brake))}, BUDGET IS ${formatTargetDuration(Math.floor(faTargetBudget_s))}
                    </div>
                )}
                {faPlanType == 'accel' && isFinite(faTargetAccel_mps2) && (
                    <div className='bc-fa-ok'>
                        ● ACCEL SUFFICIENT - BRAKE REQUIRES {`${(faPlan.a_mps2 / G).toFixed(2)} G`}, MAX ACCEL IS ${`${(faTargetAccel_mps2 / G).toFixed(2)} G`}
                    </div>
                )}

                {faAccelComputed && (
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
            value={`${(faPlan.t_brake/3600.0).toFixed(2)}h`}
            highlight
            flickerKey={flickerKey}
            />
            </div>
        )}
        </div>
    )
}
export type ApproachInputSummaryArgs = {
    faDistance : string, faDistanceUnit : string,
    faVrel : string, faVrelUnit : string,
    faVArrival : string, faVArrivalUnit : string,
    faTargetAccel_mps2 : number, faTargetBudget_s : number | null,
    faPlanType : string, faHasDoublePlan : boolean,
    noWakeEnabled : string, standoffKm : string,
    faParsedGameTime : GameDateTime | null,
}
function getApproachInputCopy(args : ApproachInputSummaryArgs)
{
    const {
        faDistance, faDistanceUnit,
        faVrel, faVrelUnit,
        faVArrival, faVArrivalUnit,
        faTargetAccel_mps2, faTargetBudget_s,
        faPlanType, faHasDoublePlan,
        noWakeEnabled, standoffKm,
        faParsedGameTime,
    } = args;
    const lines = [];
    const faDistLabel = faDistanceUnit === 'au' ? 'AU' : faDistanceUnit === 'gm' ? 'GM' : faDistanceUnit === 'km' ? 'km' : 'm';
    lines.push('-- CURRENT STATE --');
    lines.push(`Range: ${parseNum(faDistance)} ${faDistLabel}`);
    lines.push(`VREL: ${parseNum(faVrel)} ${faVrelUnit} (CLOSING)`);
    lines.push('');
    lines.push('-- ARRIVAL PARAMETERS --');
    if (faVArrival.trim() !== '' && faVArrival !== '0') {
        lines.push(`TGT Vel: ${parseNum(faVArrival)} ${faVArrivalUnit}`);
    }
    lines.push(noWakeEnabled === 'enabled' ? 'Stand-off: NO-WAKE ZONE (300 km)' : `Stand-off: ${parseNum(standoffKm)} km`);
    lines.push('');
    lines.push('-- VESSEL PARAMETERS --');
    if (isFinite(faTargetAccel_mps2)) {
        lines.push(`Acceleration: ${(faTargetAccel_mps2 / G).toFixed(2)} G`);
    }
    if (faTargetBudget_s != null && isFinite(faTargetBudget_s)) {
        lines.push(`Reactant Budget: ${(faTargetBudget_s / 3600).toFixed(2)}h`);
    }
    if (faHasDoublePlan)
    {
        lines.push(`Optimization Target: ${faPlanType}`);
    }
    const nowString = formatGameTime(addGameTime(faParsedGameTime, 0))
    if (nowString !== null) {
        lines.push('');
        lines.push('-- GAME CLOCK --');
        lines.push(`Current Time: ${nowString}`);
    }
    return lines;
}
export default ApproachOutput;