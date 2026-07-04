import { Clock } from "lucide-react";
import InputRow from "../components/InputRow.js";
import StandoffControl from "../components/StandoffControl.js";
import { formatTargetDuration } from "../utils/formatters.js";
import InputNote from "../components/InputNote.js";
import { G, TOOLTIP_IMG_ACCELERATION, TOOLTIP_IMG_CURRENTVEL, TOOLTIP_IMG_DISTANCE, TOOLTIP_IMG_REACTANTBUDGET, TOOLTIP_IMG_VCRS } from "../utils/constants.js";

type stringSetter = React.Dispatch<React.SetStateAction<string>>
type booleanSetter = React.Dispatch<React.SetStateAction<boolean>>

export type BurnInputArgs = {
    distance : string, setDistance : stringSetter, distanceUnit : string, setDistanceUnit : stringSetter, 
    vrel : string, setVrel : stringSetter, vrelUnit : string, setVrelUnit : stringSetter,
    v0Direction : string, setV0Direction : stringSetter,
    vcrs : string, setVcrs : stringSetter, vcrsUnit : string, setVcrsUnit : stringSetter,
    vArrival : string, setVArrival : stringSetter, vArrivalUnit : string, setVArrivalUnit : stringSetter,
    noWakeEnabled : boolean, setNoWakeEnabled : booleanSetter,
    standoffKm : string, setStandoffKm : stringSetter, standoff_m : number, standoffError : string | null,
    accel : string, setAccel : stringSetter, targetAccelError : boolean,
    targetDuration : string, setTargetDuration : stringSetter, targetDurationError : boolean, targetDuration_s : number | null,
    reactantBudget : string, setReactantBudget : stringSetter, targetBudgetError : boolean, targetBudget_s : number | null,
    flipTime : string, setFlipTime : stringSetter, flipTimeValid : boolean, flipTimeError : boolean,
    gameStartTime : string, setGameStartTime : stringSetter, gameTimeError : boolean, gameTimeValid : boolean,
    isDriftMode : boolean, anyConstraintAttempted : boolean
}

function BurnInput({args} : {args : BurnInputArgs}) {
    const {
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
    } = args;
    return (<>
        {/* -- Current State -- */}
        <div className="bc-panel-header">◇ Current State</div>
        <InputRow
        label="Current RNG"
        value={distance}
        onChange={setDistance}
        unit={distanceUnit}
        units={['km', 'gm', 'au']}
        onUnitChange={setDistanceUnit}
        placeholder="e.g. 18902"
        invalid={distance.trim() === ''}
        inputMode="decimal"
        tooltip={{
            desc: 'After selecting your target destination, input the distance to target.',
            img: TOOLTIP_IMG_DISTANCE,
        }}
        />
        <InputNote 
            note = {
                standoffError === 'within-standoff' ? noWakeEnabled
                    ? '⚠ DESTINATION IS WITHIN THE 300 KM NO-WAKE ZONE'
                    : `⚠ DESTINATION IS WITHIN THE STAND-OFF ZONE (${standoffKm} KM)` 
                : null
            }
            style = {
                standoffError === 'within-standoff' ? { color: 'var(--red)' } : undefined
            }
        />
        <InputRow
        label="Current VREL"
        value={vrel}
        onChange={setVrel}
        unit={vrelUnit}
        units={['m/s', 'km/s']}
        onUnitChange={setVrelUnit}
        placeholder="e.g. 511.19"
        invalid={vrel.trim() === ''}
        inputMode="decimal"
        tooltip={{
            desc: "Input your vessel's current velocity to the target. If no ETA is present, set mode to RECEDING.",
            img: TOOLTIP_IMG_CURRENTVEL,
        }}
        />
        <div style={{ display: 'flex', gap: 4, marginLeft: 118, marginBottom: 8 }}>
        <button
            className={`bc-unit-btn${v0Direction === 'closing' ? ' active' : ''}`}
            onClick={() => setV0Direction('closing')}
        >
            CLOSING
        </button>
        <button
            className={`bc-unit-btn${v0Direction === 'receding' ? ' active' : ''}`}
            onClick={() => setV0Direction('receding')}
            style={{
            color: v0Direction === 'receding' ? 'var(--red)' : undefined,
            borderColor: v0Direction === 'receding' ? 'var(--red)' : undefined,
            background: v0Direction === 'receding' ? 'rgba(255,93,93,0.15)' : undefined,
            }}
        >
            RECEDING
        </button>
        </div>
        <InputRow
        label="Current VCRS"
        value={vcrs}
        onChange={setVcrs}
        unit={vcrsUnit}
        units={['m/s', 'km/s']}
        onUnitChange={setVcrsUnit}
        placeholder="e.g. -0.02"
        tooltip={{
            desc: 'Input your VCRS to the target destination.',
            img: TOOLTIP_IMG_VCRS,
        }}
        />

        {/* -- Arrival Parameters -- */}
        <div className="bc-panel-header" style={{ marginTop: 20 }}>
        ◇ Arrival Parameters
        </div>
        <InputRow
        label={noWakeEnabled ? 'Tgt Vel at 300km' : `Tgt Vel at ${standoffError !== 'invalid-standoff' ? (Math.round(standoff_m)/1000): '?'}km`}
        value={vArrival}
        onChange={setVArrival}
        unit={vArrivalUnit}
        units={['m/s', 'km/s']}
        onUnitChange={setVArrivalUnit}
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
        value={accel}
        onChange={setAccel}
        units={[]}
        placeholder="e.g. 1.95g"
        invalid={!anyConstraintAttempted || targetAccelError}
        tooltip={{
            desc: 'Enter your desired sustained acceleration for this burn. Leave blank to solve for required acceleration from Desired Travel Time.',
            img: TOOLTIP_IMG_ACCELERATION,
        }}
        />
        <InputRow
        label="Desired Travel Time"
        value={targetDuration}
        onChange={setTargetDuration}
        units={[]}
        placeholder="e.g. 4d 3h 2m 37s or HH:MM:SS"
        invalid={!anyConstraintAttempted || targetDurationError}
        />
        <InputNote 
            note = {
                targetDurationError ? "INVALID FORMAT - USE 4D 3H 2M 37S OR HH:MM:SS" :
                targetDuration_s != null ? `● ${formatTargetDuration(targetDuration_s)}` : 
                null
            }
            style = {
                targetDurationError ? { color: 'var(--red)' } :
                targetDuration_s != null ? { color: 'var(--green)' } : 
                undefined
            }
        />
        <InputRow
        label="Reactant Budget"
        value={reactantBudget}
        onChange={setReactantBudget}
        units={[]}
        placeholder="e.g. 3h 30m or 12600"
        invalid={!anyConstraintAttempted || targetBudgetError}
        tooltip={{
            desc: 'Enter the amount of reactant you plan to allocate to this burn. It is not recommended to commit all your available reactant.',
            img: TOOLTIP_IMG_REACTANTBUDGET,
        }}
        />
        <InputNote 
            note = {
                targetBudgetError ? "INVALID FORMAT - USE 1D 1H 17M 55S OR 37.15H" :
                targetBudget_s != null ? `● ${(targetBudget_s / 3600).toFixed(2)}h` : 
                null
            }
            style = {
                targetBudgetError ? { color: 'var(--red)' } :
                targetBudget_s != null ? { color: 'var(--green)' } : 
                undefined
            }
        />
        <InputNote 
            note = {
                isDriftMode ? "◈ DRIFT MODE ACTIVE" : null
            }
            style = {
                isDriftMode ? { color: 'var(--amber)' } : undefined
            }
        />
        <div className="bc-panel-header" style={{ marginTop: 20 }}>
        ◇ Ship Parameters
        </div>
        <InputRow
        label="Flip Time"
        value={flipTime}
        onChange={setFlipTime}
        units={[]}
        placeholder="e.g. 60 or 1m 30s"
        invalid={!flipTimeValid}
        />
        <InputNote 
            note = {
                flipTimeError ? "INVALID FORMAT - USE 60, 1M 30S, ETC." : null
            }
            style = {
                flipTimeError ? { color: 'var(--red)' } : undefined
            }
        />

        {/* -- Game Clock -- */}
        
        <div className="bc-panel-header" style={{ marginTop: 20 }}>
        ◇ Game Clock
        </div>
        <InputRow
        labelIcon={(<Clock size={10} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />)}
        label="Burn Start"
        value={gameStartTime}
        onChange={setGameStartTime}
        units={[]}
        placeholder="e.g. 60 or 1m 30s"
        invalid={gameTimeError}
        />
        <InputNote 
            note = {
                gameTimeError ? "INVALID FORMAT - USE YYYY-MM-DD HH:MM:SS OR HH:MM:SS" :
                gameTimeValid ? "● TARGETS COMPUTED FROM GAME CLOCK" :
                "LEAVE BLANK FOR RELATIVE (T+) TIMES - DATE OPTIONAL"
            }
            style = {
                gameTimeError ? { color: 'var(--red)' } :
                gameTimeValid ? { color: 'var(--green)' } : 
                undefined
            }
        />
    </>);
}
export function getBurnInputCopy(args : BurnInputArgs, computed_accel_mps2 : number | null) 
{
    const {
        distance, distanceUnit, 
        vrel, vrelUnit,
        v0Direction,
        vcrs, vcrsUnit,
        vArrival, vArrivalUnit,
        noWakeEnabled, standoffKm,
        accel,
        targetDuration,
        reactantBudget,
        flipTime,
        gameStartTime
    } = args;
    const lines = [];
    const distLabel =
        distanceUnit === 'au' ? 'AU' : distanceUnit === 'gm' ? 'GM' : distanceUnit === 'km' ? 'km' : 'm';
    lines.push('-- CURRENT STATE --');
    lines.push(`Range: ${distance} ${distLabel}`);
    lines.push(`VREL: ${vrel} ${vrelUnit} (${v0Direction.toUpperCase()})`);
    if (vcrs.trim() !== '') lines.push(`VCRS: ${vcrs} ${vcrsUnit}`);
    lines.push('');
    lines.push('-- ARRIVAL PARAMETERS --');
    if (vArrival.trim() !== '' && vArrival !== '0') lines.push(`TGT Vel: ${vArrival} ${vArrivalUnit}`);
    lines.push(noWakeEnabled ? 'Stand-off: NO-WAKE ZONE (300 km)' : `Stand-off: ${standoffKm} km`);
    if (reactantBudget.trim() !== '') lines.push(`Reactant Budget: ${reactantBudget}`);
    lines.push('');
    lines.push('-- VESSEL PARAMETERS --');
    if (computed_accel_mps2 !== null) {
        lines.push(`Acceleration: ${(computed_accel_mps2 / G).toFixed(2)} G (computed)`);
    } else {
        lines.push(`Acceleration: ${accel} G`);
    }
    lines.push(`Flip Time: ${flipTime}`);
    if (targetDuration.trim() !== '') lines.push(`Desired Travel Time: ${targetDuration}`);
    if (gameStartTime.trim() !== '') {
        lines.push('');
        lines.push('-- GAME CLOCK --');
        lines.push(`Current Time: ${gameStartTime}`);
    }
    return lines;
}

export default BurnInput; 