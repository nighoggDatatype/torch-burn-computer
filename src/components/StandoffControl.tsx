import ButtonArray from "./ButtonArray.js";
import InputNote from "./InputNote.js";
import InputRow from "./InputRow.js";

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

function StandoffControl(
  { noWakeEnabled, setNoWakeEnabled, standoffKm, setStandoffKm, standoffError } : 
  { noWakeEnabled: boolean, 
    setNoWakeEnabled : React.Dispatch<React.SetStateAction<boolean>>, 
    standoffKm: string, 
    setStandoffKm: React.Dispatch<React.SetStateAction<string>>,
    standoffError: string | null }
) {
  return (
    <>
      {/* STAND-OFF DISTANCE - locked at 300km when NO-WAKE ZONE, editable in OPEN SPACE */}
      <InputRow
      label="Stand-off"
      value={noWakeEnabled ? '300km' : standoffKm}
      onChange={noWakeEnabled ? () => {} : setStandoffKm}
      units={[]}
      placeholder="e.g. 2.5km"
      invalid={standoffError === 'invalid-standoff'}
      disabled={noWakeEnabled}
      inputMode="decimal"
      />
      <InputNote 
          note = {
              standoffError === 'invalid-standoff' ? "INVALID STAND-OFF DISTANCE" : null
          }
          style = {
              standoffError === 'invalid-standoff' ? { color: 'var(--red)' } : undefined
          }
      />
      <ButtonArray
        value={noWakeEnabled}
        setValue={setNoWakeEnabled}
        buttonList={[
          { value: false, label: "OPEN SPACE", style: {}},
          { value: true,  label: "NO-WAKE ZONE", style: {
              color: 'var(--cyan)',
              borderColor: 'var(--cyan)',
              background: 'rgba(77,208,255,0.12)',
          }}
        ]}
        />
    </>
  );
}
export default StandoffControl;