

type ButtonConfig<T> = {
    value : T,
    label : string,
    style : {
        color: string
        borderColor: string
        background: string
    } | {}
}

function ButtonArray<T>(
    { value, setValue, buttonList } : 
    { value: T, setValue: React.Dispatch<React.SetStateAction<T>>, buttonList: ButtonConfig<T>[] }) {
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