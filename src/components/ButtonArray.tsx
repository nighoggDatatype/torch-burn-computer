

type ButtonConfig = {
    value : string,
    label : string,
    style : {
        color: string
        borderColor: string
        background: string
    } | {}
}

function ButtonArray(
    { value, setValue, buttonList } : 
    { value: string, setValue: (value: string) => void, buttonList: ButtonConfig[] }) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 118, marginBottom: 8 }}
    >
        {buttonList.map((buttonConfig, _) => {
            return <button
            className={`bc-unit-btn${buttonConfig.value === value ? ' active' : ''}`}
            onClick={() => setValue(buttonConfig.value)}
            style={ buttonConfig.value === value ? buttonConfig.style : {}}
            >
                {buttonConfig.label}
            </button>
        })}
    </div>
  );
}
export default ButtonArray;