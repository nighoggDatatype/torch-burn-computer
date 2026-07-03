import { useEffect, useState } from "react";

function BootSplash()
{
    
    const [booting, setBooting] = useState(() => {
    try {
        return !sessionStorage.getItem('pa_booted');
    } catch {
        return false;
    }
    });
    const [bootFade, setBootFade] = useState(false);
    const [visibleLines, setVisibleLines] = useState<number[]>([]);

    useEffect(() => {
    if (!booting) return;
    try {
        sessionStorage.setItem('pa_booted', '1');
    } catch {
        /* restricted context - skip */
    }
    const timers: (number | undefined)[] = [];
    const lineDelays = [0, 300, 600, 1100, 1700, 2300, 2900, 3500, 4100, 5200];
    lineDelays.forEach((delay, i) => {
        timers.push(setTimeout(() => setVisibleLines((prev) => [...prev, i]), delay));
    });
    timers.push(setTimeout(() => setBootFade(true), 7000));
    timers.push(setTimeout(() => setBooting(false), 8000));
    return () => timers.forEach(clearTimeout);
    }, [booting]); // booting only true on first mount; guard above makes subsequent runs no-ops
    return <>
    {booting && (
        <div className={`bc-boot${bootFade ? ' fade-out' : ''}`}>
          <div className="bc-boot-inner">
            {[
              ['POLARIS ASTRONAUTICS', ''],
              ['MANUAL TORCH BURN GUIDANCE COMPUTER', 'dim'],
              ['\u00a0', 'dim'],
              ['INITIALIZING NAV SUBSYSTEM...', 'dim'],
              ['TORCH DRIVE INTERFACE........OK', 'ok'],
              ['BURN TABLE INTEGRITY.........OK', 'ok'],
              ['NO-WAKE ZONE REGISTRY........OK', 'ok'],
              ['GAME CLOCK SYNC..............OK', 'ok'],
              ['\u00a0', 'dim'],
              ['SYSTEM READY', 'ready'],
            ].map(([text, cls], i) => (
              <div
                key={i}
                className={`bc-boot-line${cls ? ' ' + cls : ''}${visibleLines.includes(i) ? ' visible' : ''}`}
              >
                {text}
                {cls === 'ready' && visibleLines.includes(i) && <span className="bc-boot-cursor" />}
              </div>
            ))}
          </div>
        </div>
    )}
    </>
}
export default BootSplash