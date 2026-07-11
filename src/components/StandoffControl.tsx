import ButtonArray from "./ButtonArray.js";
import InputNote from "./InputNote.js";
import InputRow from "./InputRow.js";

function StandoffControl(
  { noWakeEnabled, setNoWakeEnabled, standoffKm, setStandoffKm, standoffError } : 
  { noWakeEnabled: string, 
    setNoWakeEnabled : (value: string) => void, 
    standoffKm: string, 
    setStandoffKm: (value: string) => void,
    standoffError: string | null }
) {
  return (
    <>
      {/* STAND-OFF DISTANCE - locked at 300km when NO-WAKE ZONE, editable in OPEN SPACE */}
      <InputRow
      label="Stand-off"
      value={noWakeEnabled === 'enabled' ? '300km' : standoffKm}
      onChange={noWakeEnabled === 'enabled' ? () => {} : setStandoffKm}
      units={[]}
      placeholder="e.g. 2.5km"
      invalid={standoffError === 'invalid-standoff'}
      disabled={noWakeEnabled === 'enabled'}
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
          { value: 'disabled', label: "OPEN SPACE", style: null},
          { value: 'enabled',  label: "NO-WAKE ZONE", style: {
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