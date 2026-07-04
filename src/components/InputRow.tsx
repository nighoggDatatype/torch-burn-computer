import React from "react";

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
  onChange: React.Dispatch<React.SetStateAction<string>>,
  unit?: string,
  units: string[],
  onUnitChange?: React.Dispatch<React.SetStateAction<string>>,
  tooltip? : {desc: string, img: string},
  placeholder?: string,
  invalid? : boolean,
  disabled? : boolean,
  inputMode? : "text" | "decimal"
}) {
  const id = React.useId();
  const [showTip, setShowTip] = React.useState(false);
  const [tipPos, setTipPos] = React.useState({ top: 0, left: 0 });
  const badgeRef = React.useRef<HTMLButtonElement>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);

  const openTip = () => {
    if (badgeRef.current) {
      const rect = badgeRef.current.getBoundingClientRect();
      setTipPos({ top: rect.bottom + 6, left: rect.left });
    }
    setShowTip(true);
  };

  // After the card renders, measure its real height and reposition if needed
  React.useEffect(() => {
    if (!showTip || !cardRef.current || !badgeRef.current) return;
    const card = cardRef.current;
    const rect = badgeRef.current.getBoundingClientRect();
    const cardHeight = card.offsetHeight;
    const spaceBelow = window.innerHeight - rect.bottom - 6;
    const spaceAbove = rect.top - 6;
    const top =
      spaceBelow >= cardHeight || spaceBelow >= spaceAbove
        ? rect.bottom + 6
        : Math.max(8, rect.top - cardHeight - 6);
    setTipPos({ top, left: rect.left });
  }, [showTip]);

  return (
    <div className="bc-input-row">
      <label className="bc-label" htmlFor={id} style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ flex: 1 }}>{labelIcon}{label}</span>
        {tooltip && (
          <span className="bc-tooltip-wrap">
            <button
              type="button"
              className="bc-tooltip-badge"
              ref={badgeRef}
              aria-label={`Help for ${label}`}
              onMouseEnter={openTip}
              onMouseLeave={() => setShowTip(false)}
              onFocus={openTip}
              onBlur={() => setShowTip(false)}
            >
              ?
            </button>
            {showTip && (
              <div
                className="bc-tooltip-card"
                ref={cardRef}
                style={{ top: tipPos.top, left: tipPos.left }}
              >
                <div className="bc-tooltip-header">{label}</div>
                <div className="bc-tooltip-desc">{tooltip.desc}</div>
                {tooltip.img && (
                  <img
                    className="bc-tooltip-img"
                    src={tooltip.img}
                    alt={label}
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                )}
              </div>
            )}
          </span>
        )}
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