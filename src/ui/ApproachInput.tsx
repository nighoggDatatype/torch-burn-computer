import { Clock } from "lucide-react";
import InputRow from "../components/InputRow.js";
import StandoffControl from "../components/StandoffControl.js";
import { G, TOOLTIP_IMG_ACCELERATION, TOOLTIP_IMG_CURRENTVEL, TOOLTIP_IMG_DISTANCE, TOOLTIP_IMG_REACTANTBUDGET } from "../utils/constants.js";
import InputNote from "../components/InputNote.js";
import ButtonArray from "../components/ButtonArray.js";

type stringSetter = (value: string) => void

export type ApproachInputArgs = {
    faDistance : string, setFaDistance : stringSetter, faDistanceUnit : string, setFaDistanceUnit : stringSetter, 
    faVrel : string, setFaVrel : stringSetter, faVrelUnit : string, setFaVrelUnit : stringSetter,
    faVArrival : string, setFaVArrival : stringSetter, faVArrivalUnit : string, setFaVArrivalUnit : stringSetter,
    faAccel : string, setFaAccel : stringSetter, faTargetAccelError : boolean,
    faBudget : string, setFaBudget : stringSetter, faTargetBudgetError : boolean, faTargetBudget_s : number | null,
    faPlanType : string, setFaPlanType : stringSetter, faHasDoublePlan : boolean,
    noWakeEnabled : string, setNoWakeEnabled : stringSetter,
    standoffKm : string,setStandoffKm : stringSetter, standoff_m : number,  standoffError : string | null,
    faGameStartTime : string, setFaGameStartTime : stringSetter, faGameTimeError : boolean, faGameTimeValid : boolean,
}


function ApproachInput({args} : {args : ApproachInputArgs})
{
    const {
        faDistance, setFaDistance, faDistanceUnit, setFaDistanceUnit,
        faVrel, setFaVrel, faVrelUnit, setFaVrelUnit,
        faVArrival, setFaVArrival, faVArrivalUnit, setFaVArrivalUnit,
        faAccel, setFaAccel, faTargetAccelError,
        faBudget, setFaBudget, faTargetBudgetError, faTargetBudget_s, 
        faPlanType, setFaPlanType, faHasDoublePlan,
        noWakeEnabled, setNoWakeEnabled, 
        standoffKm, setStandoffKm, standoff_m, standoffError,
        faGameStartTime, setFaGameStartTime, faGameTimeError, faGameTimeValid
    } = args;
    return (
    <>
        {/* -- Current State -- */}
        <div className="bc-panel-header">◇ Current State</div>
        <div className="bc-fa-notice">
        VCRS SHOULD BE 0.00 M/S BEFORE FINAL APPROACH - NULL CROSS-TRACK VELOCITY BEFORE
        PROCEEDING
        </div>
        <InputRow
        label="Current RNG"
        value={faDistance}
        onChange={setFaDistance}
        unit={faDistanceUnit}
        units={['km', 'gm', 'au']}
        onUnitChange={setFaDistanceUnit}
        placeholder="e.g. 18902"
        invalid={faDistance.trim() === ''}
        inputMode="decimal"
        tooltip={{
            desc: 'After selecting your target destination, input the distance to target.',
            img: TOOLTIP_IMG_DISTANCE,
        }}
        />
        <InputNote 
            note = {
                standoffError === 'within-standoff' ? noWakeEnabled === 'enabled'
                    ? '⚠ DESTINATION IS WITHIN THE 300 KM NO-WAKE ZONE'
                    : `⚠ DESTINATION IS WITHIN THE STAND-OFF ZONE (${standoffKm} KM)` 
                : null
            }
            style = {
                standoffError === 'within-standoff' ? { color: 'var(--red)' } : undefined
            }
        />
        <InputRow
        label="Current VREL (Closing)"
        value={faVrel}
        onChange={setFaVrel}
        unit={faVrelUnit}
        units={['m/s', 'km/s']}
        onUnitChange={setFaVrelUnit}
        placeholder="e.g. 511.19"
        invalid={faVrel.trim() === ''}
        inputMode="decimal"
        tooltip={{
            desc: "Input your vessel's current velocity to the target.",
            img: TOOLTIP_IMG_CURRENTVEL,
        }}
        />

        {/* -- Arrival Parameters -- */}
        <div className="bc-panel-header" style={{ marginTop: 20 }}>
        ◇ Arrival Parameters
        </div>
        <InputRow
        label={noWakeEnabled === 'enabled' ? 'Tgt Vel at 300km' : `Tgt Vel at ${standoffError !== 'invalid-standoff' ? (Math.round(standoff_m)/1000): '?'}km`}
        value={faVArrival}
        onChange={setFaVArrival}
        unit={faVArrivalUnit}
        units={['m/s', 'km/s']}
        onUnitChange={setFaVArrivalUnit}
        placeholder="e.g. 0"
        inputMode="decimal"
        />
        <StandoffControl
        noWakeEnabled={noWakeEnabled}
        setNoWakeEnabled={setNoWakeEnabled}
        standoffKm={standoffKm}
        setStandoffKm={setStandoffKm}
        standoffError={standoffError}
        />

        {/* -- Trip Parameters -- */}
        <div className="bc-panel-header" style={{ marginTop: 20 }}>
        ◇ Trip Parameters
        </div>
        <InputRow
        label="Acceleration"
        value={faAccel}
        onChange={setFaAccel}
        units={[]}
        placeholder="e.g. 1.95g"
        invalid={faTargetAccelError}
        tooltip={{
            desc: 'Enter your desired sustained acceleration for this burn. Leave blank for constant-burn mode - required G computed automatically.',
            img: TOOLTIP_IMG_ACCELERATION,
        }}
        />
        <InputRow
        label="Reactant Budget"
        value={faBudget}
        onChange={setFaBudget}
        units={[]}
        placeholder="e.g. 3h 30m or 12600"
        invalid={faTargetBudgetError}
        tooltip={{
            desc: 'Enter the amount of reactant you plan to allocate to this burn. It is not recommended to commit all your available reactant.',
            img: TOOLTIP_IMG_REACTANTBUDGET,
        }}
        />
        <InputNote 
            note = {
                faTargetBudgetError ? "INVALID FORMAT - USE 1D 1H 17M 55S OR 37.15H" :
                faTargetBudget_s != null ? `● ${(faTargetBudget_s / 3600).toFixed(2)}h` :
                null
            }
            style = {
                faTargetBudgetError ? { color: 'var(--red)' } :
                faTargetBudget_s != null ? { color: 'var(--green)' } : 
                undefined
            }
        />
        {faHasDoublePlan && (
            <ButtonArray
            label="Optimzation Target"
            tooltip="Between travel/deceleration duration, and acceleration, select one to minimize. The other constraint will be maximized up to the limit to minimize the selected constraint, if possilbe"
            value={faPlanType}
            setValue={setFaPlanType}
            buttonList={[
                { value: 'budget', label: "DURATION / BUDGET", style: {}},
                { value: 'accel', label: "ACCELERATION", style: {}}, //TODO: Add special styling here
            ]}
        />)}

        {/* -- Game Clock -- */}
        <div className="bc-panel-header" style={{ marginTop: 20 }}>
        ◇ Game Clock
        </div>
        <InputRow
        labelIcon={(<Clock size={10} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />)}
        label="Current Time"
        value={faGameStartTime}
        onChange={setFaGameStartTime}
        units={[]}
        placeholder="e.g. 60 or 1m 30s"
        invalid={faGameTimeError}
        />
        <InputNote 
            note = {
                faGameTimeError ? "INVALID FORMAT - USE YYYY-MM-DD HH:MM:SS OR HH:MM:SS" :
                faGameTimeValid ? "● TARGETS COMPUTED FROM GAME CLOCK" :
                "LEAVE BLANK FOR RELATIVE (T+) TIMES - DATE OPTIONAL"
            }
            style = {
                faGameTimeError ? { color: 'var(--red)' } :
                faGameTimeValid ? { color: 'var(--green)' } : 
                undefined
            }
        />
    </>
    )
}
export function getApproachInputCopy(args : ApproachInputArgs, computed_accel_mps2 : number | null)
{
    const {
        faDistance, faDistanceUnit,
        faVrel, faVrelUnit,
        faVArrival, faVArrivalUnit,
        faAccel,
        faBudget,
        noWakeEnabled, standoffKm,
        faGameStartTime,
    } = args;
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
    lines.push(noWakeEnabled === 'enabled' ? 'Stand-off: NO-WAKE ZONE (300 km)' : `Stand-off: ${standoffKm} km`);
    if (faBudget.trim() !== '') lines.push(`Reactant Budget: ${faBudget}`);
    lines.push('');
    lines.push('-- VESSEL PARAMETERS --');
    if (computed_accel_mps2 !== null) {
        lines.push(`Acceleration: ${(computed_accel_mps2 / G).toFixed(2)} G (computed)`);
    } else {
        lines.push(`Acceleration: ${faAccel} G`);
    }
    if (faGameStartTime.trim() !== '') {
    lines.push('');
    lines.push('-- GAME CLOCK --');
    lines.push(`Current Time: ${faGameStartTime}`);
    }
    return lines;
}
export default ApproachInput;