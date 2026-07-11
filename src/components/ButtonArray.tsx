import React from "react"
import Tooltip from "./Tooltip.js"


type ButtonConfig = {
    value : string,
    label : string,
    style : {
        color: string
        borderColor: string
        background: string
    } | null
}
function ButtonArray(
    { label = null, tooltip = null, value, setValue, buttonList } : 
    { label? : string | null, tooltip? : string | null, value: string, setValue: (value: string) => void, buttonList: ButtonConfig[] }) {
    const buttonArray = buttonList.map((buttonConfig) => {
        return <button
        key={buttonConfig.value}
        className={`bc-unit-btn${buttonConfig.value === value ? ' active' : ''}`}
        onClick={() => setValue(buttonConfig.value)}
        style={ buttonConfig.value === value ? buttonConfig.style ?? {} : {}}
        >
            {buttonConfig.label}
        </button>
    })
    const labelId = React.useId();
    return label === null ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 118, marginBottom: 8 }}>
    {buttonArray}
    </div>
    ) : (
    <div className="bc-input-row">
      <label className="bc-label" htmlFor={labelId} style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ flex: 1 }}>{label}</span>
        {tooltip !== null && (<Tooltip label={label} desc={tooltip} img=""/>)}
      </label>
      {buttonArray}
    </div>
    );
}
export default ButtonArray;