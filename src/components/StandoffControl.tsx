function NoWakeToggle({ noWakeEnabled, setNoWakeEnabled } : { noWakeEnabled: boolean, setNoWakeEnabled: React.Dispatch<React.SetStateAction<boolean>> }) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 118, marginBottom: 8 }}
    >
      <button
        className={`bc-unit-btn${!noWakeEnabled ? ' active' : ''}`}
        onClick={() => setNoWakeEnabled(false)}
      >
        OPEN SPACE
      </button>
      <button
        className={`bc-unit-btn${noWakeEnabled ? ' active' : ''}`}
        onClick={() => setNoWakeEnabled(true)}
        style={
          noWakeEnabled
            ? {
                color: 'var(--cyan)',
                borderColor: 'var(--cyan)',
                background: 'rgba(77,208,255,0.12)',
              }
            : {}
        }
      >
        NO-WAKE ZONE
      </button>
    </div>
  );
}

function StandoffControl({ noWakeEnabled, setNoWakeEnabled, standoffKm, setStandoffKm } : { noWakeEnabled: boolean, setNoWakeEnabled : React.Dispatch<React.SetStateAction<boolean>>, standoffKm: string, setStandoffKm: React.Dispatch<React.SetStateAction<string>> }) {
  return (
    <>
      {/* STAND-OFF DISTANCE - locked at 300km when NO-WAKE ZONE, editable in OPEN SPACE */}
      <div className="bc-input-row">
        <div className="bc-label">Stand-off</div>
        <input
          className="bc-input"
          type="text"
          inputMode="decimal"
          value={noWakeEnabled ? '300km' : standoffKm}
          placeholder="e.g. 2.5km"
          disabled={noWakeEnabled}
          onChange={(e) => !noWakeEnabled && setStandoffKm(e.target.value)}
        />
      </div>
      <NoWakeToggle noWakeEnabled={noWakeEnabled} setNoWakeEnabled={setNoWakeEnabled} />
    </>
  );
}
export default StandoffControl;