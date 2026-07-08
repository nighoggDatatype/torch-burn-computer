import React from "react";
import Tooltip from "./Tooltip.js";

function InputRow({
  labelIcon,
  label,
  value,
  onChange,
  unit,
  units,
  onUnitChange = () => {},
  tooltip,
  placeholder = "",
  invalid = false,
  disabled = false,
  inputMode = 'text',
} : {
  labelIcon? : React.JSX.Element,
  label: string,
  value: string,
  onChange: (value: string) => void,
  unit?: string,
  units: string[],
  onUnitChange?: (value: string) => void,
  tooltip? : {desc: string, img: string},
  placeholder?: string,
  invalid? : boolean,
  disabled? : boolean,
  inputMode? : "text" | "decimal"
}) {
  const id = React.useId();
  return (
    <div className="bc-input-row">
      <label className="bc-label" htmlFor={id} style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ flex: 1 }}>{labelIcon}{label}</span>
        {tooltip && (<Tooltip label={label} desc={tooltip.desc} img={tooltip.img}/>)}
      </label>
      <input
        id={id}
        className={`bc-input${invalid ? ' invalid' : ''}`}
        type="text"
        inputMode={inputMode}
        value={value}
        placeholder={placeholder || ''}
        aria-invalid={invalid ? 'true' : undefined}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {units && units.length > 0 && (
        <div className="bc-unit-toggle">
          {units.map((u: string) => (
            <button
              key={u}
              className={`bc-unit-btn ${unit === u ? 'active' : ''}`}
              onClick={() => onUnitChange(u)}
            >
              {u}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default InputRow;