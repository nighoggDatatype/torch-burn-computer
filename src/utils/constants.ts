export const G = 9.80665; // standard gravity, m/s²
export const AU = 149_597_870_700; // meters per astronomical unit
// Game day: standard 24h clock + "untime" (24:00:00 → 24:20:58),
// then rolls to 00:00:00. Last displayed second 24:20:58 = 87,658 s.
// DAY = 87,659 is the exclusive rollover point; the last *valid* second is 87,658.
export const DAY = 24 * 3600 + 20 * 60 + 59; // 87,659 s
export const NO_WAKE_M = 300_000; // 300 km no-wake zone at destination
export const EFFICIENCY_TIME_MULTIPLIER = 2; // efficiency trip ≤ N× the standard-burn time

export const TOOLTIP_IMG_DISTANCE = `${import.meta.env.BASE_URL}tooltips/distance.jpg`;
export const TOOLTIP_IMG_CURRENTVEL = `${import.meta.env.BASE_URL}tooltips/current-vel.jpg`;
export const TOOLTIP_IMG_VCRS = `${import.meta.env.BASE_URL}tooltips/vcrs.jpg`;
export const TOOLTIP_IMG_REACTANTBUDGET = `${import.meta.env.BASE_URL}tooltips/reactantbudget.jpg`;
export const TOOLTIP_IMG_ACCELERATION = `${import.meta.env.BASE_URL}tooltips/acceleration.jpg`;