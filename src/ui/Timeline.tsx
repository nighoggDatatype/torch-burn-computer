import TargetCell from "../components/TargetCell.js";
import { addGameTime, formatTargetDuration } from "../utils/formatters.js";
import { GameDateTime } from "../utils/parsers.js";
import { BurnPlanResult } from "../utils/physics.js";

function TimeLine({finalPlan, parsedGameTime} : {finalPlan : BurnPlanResult | null, parsedGameTime : GameDateTime | null}) {
    const finalPlanOk = finalPlan!==null && finalPlan.error === null && !finalPlan.overshoot;
    const isDriftMode = finalPlanOk && finalPlan.t_drift !== 0 && finalPlan.d_drift !== 0;

    const gameTimeValid = parsedGameTime !== null;

    const t_accel = finalPlanOk ? finalPlan.t_accel : 0;
    const t_rot = finalPlanOk ? finalPlan.t_rotate : 0;
    const t_drift = finalPlanOk ? finalPlan.t_drift : 0;
    const t_total = finalPlanOk ? finalPlan.t_total : 0;
    const t_flip_end = t_accel + t_rot;
    const t_brake_start = isDriftMode ? t_flip_end + t_drift : t_flip_end;

    const rotateTarget = gameTimeValid && finalPlanOk ? addGameTime(parsedGameTime, t_accel) : null;
    const driftEndTarget =
        gameTimeValid && finalPlanOk && isDriftMode ? addGameTime(parsedGameTime, t_brake_start) : null;
    const brakeTarget = gameTimeValid && finalPlanOk ? addGameTime(parsedGameTime, t_brake_start) : null;
    const arriveTarget = gameTimeValid && finalPlanOk ? addGameTime(parsedGameTime, t_total) : null;

    const accelPercent = t_total ? (t_accel / t_total) * 100 : 0;
    const rotatePercent = t_total ? (t_rot / t_total) * 100 : 0;
    const driftPercent = t_total && isDriftMode ? (t_drift / t_total) * 100 : 0;
    const brakePercent = t_total ? ((finalPlanOk ? finalPlan.t_brake : 0) / t_total) * 100 : 0;

    return (
    <div className="bc-panel bc-timeline-panel scratch-c">
        <div className="bc-panel-header">◇ Burn Timeline</div>

        <div className="bc-timeline">
        {finalPlanOk ? (
            <>
            {t_accel > 0 && (
                <div
                className="bc-timeline-phase accel"
                style={{ left: 0, width: `${accelPercent}%` }}
                >
                {accelPercent > 8 ? 'ACCEL' : ''}
                </div>
            )}
            {t_rot > 0 && (
                <div
                className="bc-timeline-phase rotate"
                style={{ left: `${accelPercent}%`, width: `${rotatePercent}%` }}
                >
                {rotatePercent > 6 ? 'ROT' : ''}
                </div>
            )}
            {isDriftMode && driftPercent > 0 && (
                <div
                className="bc-timeline-phase drift"
                style={{ left: `${accelPercent + rotatePercent}%`, width: `${driftPercent}%` }}
                >
                {driftPercent > 8 ? 'DRIFT' : ''}
                </div>
            )}
            <div
                className="bc-timeline-phase brake"
                style={{ left: `${accelPercent + rotatePercent + driftPercent}%`, width: `${brakePercent}%` }}
            >
                {brakePercent > 8 ? 'BRAKE' : ''}
            </div>
            <div className="bc-timeline-tick" style={{ left: 0 }}>
                T+0
            </div>
            {t_accel > 0 && rotatePercent >= 10 && (
                <div className="bc-timeline-tick key" style={{ left: `${accelPercent}%` }}>
                ↺ FLIP
                </div>
            )}
            {isDriftMode && driftPercent >= 5 && (
                <div
                className="bc-timeline-tick key"
                style={{ left: `${accelPercent + rotatePercent + driftPercent}%` }}
                >
                ⊖ BRAKE
                </div>
            )}
            {!isDriftMode && t_accel > 0 && rotatePercent >= 10 && (
                <div
                className="bc-timeline-tick key"
                style={{ left: `${accelPercent + rotatePercent}%` }}
                >
                ⊖ BRAKE
                </div>
            )}
            {!isDriftMode && t_accel > 0 && rotatePercent < 10 && (
                <div
                className="bc-timeline-tick key"
                style={{ left: `${accelPercent + rotatePercent / 2}%` }}
                >
                ↺→⊖ FLIP
                </div>
            )}
            {t_accel === 0 && (
                <div className="bc-timeline-tick key" style={{ left: `${rotatePercent}%` }}>
                ⊖ BRAKE
                </div>
            )}
            <div
                className="bc-timeline-tick"
                style={{ left: '100%', transform: 'translateX(-100%)' }}
            >
                ◉ ARRIVE
            </div>
            </>
        ) : (
            <>
            <div className="bc-timeline-phase accel" style={{ left: 0, width: '33.33%' }}>
                ?
            </div>
            <div
                className="bc-timeline-phase rotate"
                style={{ left: '33.33%', width: '33.34%' }}
            >
                ?
            </div>
            <div
                className="bc-timeline-phase brake"
                style={{ left: '66.67%', width: '33.33%' }}
            >
                ?
            </div>
            <div className="bc-timeline-tick" style={{ left: 0 }}>
                T+0
            </div>
            <div
                className="bc-timeline-tick"
                style={{ left: '100%', transform: 'translateX(-100%)' }}
            >
                ◉ ARRIVE
            </div>
            </>
        )}
        </div>

        <div className="bc-targets-grid">
        <TargetCell
            variant="rotate"
            label={
            finalPlanOk
                ? isDriftMode
                ? '↺ End Accel / Flip'
                : '↺ Begin Rotate'
                : '↺ Begin Rotate'
            }
            gameTime={finalPlanOk ? rotateTarget : null}
            relative={finalPlanOk ? `T+${formatTargetDuration(Math.floor(t_accel))}` : '--:--:--'}
        />
        <TargetCell
            variant="brake"
            label={
            finalPlanOk
                ? isDriftMode
                ? '⊖ End Drift / Brake'
                : '⊖ Begin Brake'
                : '⊖ Begin Brake'
            }
            gameTime={finalPlanOk ? (isDriftMode ? driftEndTarget : brakeTarget) : null}
            relative={finalPlanOk ? `T+${formatTargetDuration(Math.floor(t_brake_start))}` : '--:--:--'}
        />
        <TargetCell
            variant="arrive"
            label="◉ Arrival"
            gameTime={finalPlanOk ? arriveTarget : null}
            relative={finalPlanOk ? `T+${formatTargetDuration(Math.floor(t_total))}` : '--:--:--'}
        />
        </div>

        {finalPlanOk && !gameTimeValid && (
        <div
            style={{
            marginTop: 12,
            fontSize: 10,
            color: 'var(--text-dim)',
            letterSpacing: '0.1em',
            textAlign: 'center',
            }}
        >
            ▲ ENTER GAME CLOCK TIME ABOVE FOR ABSOLUTE TARGET TIMES ▲
        </div>
        )}
    </div>
    )
}
export default TimeLine;