import { FinalApproachResult } from "../solvers/approachSolvers.js";
import { BurnPlanResult } from "../solvers/physics.js";
import { APP_VERSION } from "../utils/constants.js";

function AppHeader //TODO: Consider returning the status lights
(
    {appMode, finalPlan, faPlan}:
    {appMode: string, finalPlan: BurnPlanResult | null, faPlan: FinalApproachResult | null}
)
{
    const statusText = 
        finalPlan === null ? 'STANDBY' :
        finalPlan.error !== null ? 'INVALID' :
        finalPlan.overshoot ? 'OVERSHOOT' :
        'READY';
    const faStatusText = 
        faPlan === null ? 'STANDBY' :
        faPlan.error !== null ? 'INVALID' : 
        faPlan.overshoot ? 'OVERSHOOT' : 
        'READY';
    const activeStatusText = appMode === 'approach' ? faStatusText : statusText;
    const activeHasError =
        appMode === 'approach'
        ? faPlan !== null && faPlan.error
        : (finalPlan && finalPlan.error !== null);
    const activeIsOvershoot = 
        appMode === 'approach' 
        ? faPlan && faPlan.error === null && faPlan.overshoot 
        : finalPlan && finalPlan.error === null && finalPlan.overshoot;

    return (
    <div className="bc-header">
        <div>
            <div className="bc-brand">◈ Polaris Astronautics</div>
            <div className="bc-title">Manual Torch Burn Guidance Computer</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span
            style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                color: 'var(--text-dim)',
                letterSpacing: '0.12em',
            }}
            >
            {APP_VERSION}
            </span>
            <span className="bc-status-wrap">
                <span className={`bc-status-light ${activeHasError ? 'invalid' : activeIsOvershoot ? 'overshoot' : 'ready'}`} />
            </span>
            <span className="bc-status-text" role="status" aria-live="polite">{activeStatusText}</span>
        </div>
    </div>
    )
}
export default AppHeader