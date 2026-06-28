import { Clock } from "lucide-react";
import InputRow from "../components/InputRow.js";
import StandoffControl from "../components/StandoffControl.js";
import { formatTargetDuration } from "../utils/formatters.js";

const TOOLTIP_IMG_DISTANCE = `${import.meta.env.BASE_URL}tooltips/distance.jpg`;
const TOOLTIP_IMG_CURRENTVEL = `${import.meta.env.BASE_URL}tooltips/current-vel.jpg`;
const TOOLTIP_IMG_VCRS = `${import.meta.env.BASE_URL}tooltips/vcrs.jpg`;
const TOOLTIP_IMG_REACTANTBUDGET = `${import.meta.env.BASE_URL}tooltips/reactantbudget.jpg`;
const TOOLTIP_IMG_ACCELERATION = `${import.meta.env.BASE_URL}tooltips/acceleration.jpg`;

type stringSetter = React.Dispatch<React.SetStateAction<string>>
type booleanSetter = React.Dispatch<React.SetStateAction<boolean>>

type BurnInputArgs = {
        distance : string, setDistance : stringSetter, distanceUnit : string, setDistanceUnit : stringSetter, 
        vrel : string, setVrel : stringSetter, vrelUnit : string, setVrelUnit : stringSetter,
        v0Direction : string, setV0Direction : stringSetter,
        vcrs : string, setVcrs : stringSetter, vcrsUnit : string, setVcrsUnit : stringSetter,
        vArrival : string, setVArrival : stringSetter, vArrivalUnit : string, setVArrivalUnit : stringSetter,
        noWakeEnabled : boolean, setNoWakeEnabled : booleanSetter, standoffKm : string, setStandoffKm : stringSetter, standoffError : string | null,
        accel : string, setAccel : stringSetter, targetAccelError : boolean,
        targetDuration : string, setTargetDuration : stringSetter, targetDurationError : boolean, targetDuration_s : number | null,
        reactantBudget : string, setReactantBudget : stringSetter, targetBudgetError : boolean, targetBudget_s : number | null,
        flipTime : string, setFlipTime : stringSetter, flipTimeError : boolean,
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
        noWakeEnabled, setNoWakeEnabled, standoffKm, setStandoffKm, standoffError,
        accel, setAccel, targetAccelError,
        targetDuration, setTargetDuration, targetDurationError, targetDuration_s,
        reactantBudget, setReactantBudget, targetBudgetError, targetBudget_s,
        flipTime, setFlipTime, flipTimeError,
        gameStartTime, setGameStartTime, gameTimeError, gameTimeValid,
        isDriftMode, anyConstraintAttempted
    } = args;
    const hasWakeError = standoffError !== null;
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
        {hasWakeError && (
        <div
            className="bc-field-note"
            style={{ color: 'var(--red)', marginBottom: 10, paddingLeft: 118 }}
        >
            {standoffError === 'invalid-standoff'
            ? '⚠ INVALID STAND-OFF DISTANCE'
            : noWakeEnabled
                ? '⚠ DESTINATION IS WITHIN THE 300 KM NO-WAKE ZONE'
                : `⚠ DESTINATION IS WITHIN THE STAND-OFF ZONE (${standoffKm} KM)`}
        </div>
        )}
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
        label={noWakeEnabled ? 'Tgt Vel at 300km' : `Tgt Vel at ${standoffKm || '?'}km`}
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
        <div
        className="bc-field-note"
        style={{ marginTop: 2, marginBottom: 6, paddingLeft: 118 }}
        >
        {targetDurationError ? (
            <span style={{ color: 'var(--red)' }}>
            INVALID FORMAT - USE 4D 3H 2M 37S OR HH:MM:SS
            </span>
        ) : targetDuration_s != null ? (
            <span style={{ color: 'var(--green)' }}>
            ● {formatTargetDuration(targetDuration_s)}
            </span>
        ) : null}
        </div>
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
        {reactantBudget.trim() !== '' && (
        <div className="bc-field-note" style={{ marginBottom: 6, paddingLeft: 118 }}>
            {targetBudget_s !== null ? (
            <span style={{ color: 'var(--green)' }}>
                ● {formatTargetDuration(targetBudget_s)}
            </span>
            ) : (
            <span style={{ color: 'var(--red)' }}>INVALID FORMAT</span>
            )}
        </div>
        )}
        {(isDriftMode) ? (
        <div className="bc-field-note" style={{ marginBottom: 4, paddingLeft: 118 }}>
            <span style={{ color: 'var(--amber)' }}>◈ DRIFT MODE ACTIVE</span>
        </div>
        ) : null}
        {/** TODO: Add light subdivider here */}
        <InputRow
        label="Flip Time"
        value={flipTime}
        onChange={setFlipTime}
        units={[]}
        placeholder="e.g. 60 or 1m 30s"
        invalid={flipTimeError}
        />
        {flipTimeError && (
        <div className="bc-field-note" style={{ marginBottom: 6, paddingLeft: 118 }}>
            <span style={{ color: 'var(--red)' }}>
            INVALID FORMAT - USE 60, 1M 30S, ETC.
            </span>
        </div>
        )}

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
        <div className="bc-field-note" style={{ marginTop: 6, paddingLeft: 118 }}>
        {gameTimeError ? (
            <span style={{ color: 'var(--red)' }}>
            INVALID FORMAT - USE YYYY-MM-DD HH:MM:SS OR HH:MM:SS
            </span>
        ) : gameTimeValid ? (
            <span style={{ color: 'var(--green)' }}>
            ● TARGETS COMPUTED FROM GAME CLOCK
            </span>
        ) : (
            <span>LEAVE BLANK FOR RELATIVE (T+) TIMES - DATE OPTIONAL</span>
        )}
        </div>
    </>);
}

export default BurnInput; 