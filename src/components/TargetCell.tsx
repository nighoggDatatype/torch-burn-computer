import { FinalGameTime, formatGameTime } from "../utils/formatters.js";

function TargetCell({ variant, label, gameTime, relative } : { variant: string, label: string, gameTime : FinalGameTime | null, relative: string }) {
  const displayGameTime = formatGameTime(gameTime);
  const hasGameTime = displayGameTime !== null;
  return (
    <div className={`bc-target-cell ${variant}`}>
      <div className="bc-target-label">{label}</div>
      {hasGameTime ? (
        <>
          <div className="bc-target-time game-time">{displayGameTime}</div>
          <div className="bc-target-relative">{relative}</div>
        </>
      ) : (
        <div className="bc-target-time">{relative}</div>
      )}
    </div>
  );
}
export default TargetCell