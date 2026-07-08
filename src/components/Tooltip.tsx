import React from "react";

function Tooltip({
  label,
  desc,
  img
} : {
  label: string, desc: string, img: string,
}) 
{
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
            <div className="bc-tooltip-desc">{desc}</div>
            {img && (
                <img
                className="bc-tooltip-img"
                src={img}
                alt={label}
                onError={(e) => {
                    e.currentTarget.style.display = 'none';
                }}
                />
            )}
            </div>
        )}
    </span>
    )
}
export default Tooltip;