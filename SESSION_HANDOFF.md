# Polaris Astronautics Burn Computer — Session Handoff

## Project Identity

**Tool:** Polaris Astronautics Manual Torch Burn Guidance Computer
**Stack:** React + Vite, single `App.jsx`, deployed to GitHub Pages
**Live URL:** https://bandus.github.io/torch-burn-computer
**Local path:** `E:\BurnComputer\burn-computer`
**Dev server:** `npm run dev` → localhost:5173
**Deploy sequence:** `findstr "APP_VERSION" src\App.jsx` → `git add -A && git commit -m "..."` → `npm run deploy`
**Current confirmed build:** v0.5.3

---

## What Was Accomplished (post-v0.5.3 cleanup — unversioned)

**CLEANUP PASS — Code review fixes (not a user-facing release)**

- Removed unused `framer-motion` dependency
- Fonts moved from CSS `@import` to `<link preconnect/stylesheet>` in `index.html` (fixes render-blocking)
- `index.html`: fixed favicon path to be base-aware, added `<meta name="description">` and `<meta name="theme-color">`
- CSS: deduplicated `.bc-header`/`.bc-panel` background+shadow into shared selector (cuts ~35 lines)
- CSS: removed dead rules — `.bc-status-light.clock`, `@keyframes bc-pulse-slow/-fast/-blink-hard`, `.bc-header.scratch-d`, `.bc-readout-value.dim`
- CSS: added `@media (prefers-reduced-motion: reduce)` block covering flicker, cursor, tooltip, and scanline overlay
- Hoisted `NO_WAKE_M` and `EFFICIENCY_TIME_MULTIPLIER` to top-level constants (were inside component)
- `parseGameTime`: added calendar validation (month 1-12, day 1-daysInMonth)
- Boot `useEffect`: added `booting` to dependency array to satisfy `exhaustive-deps`
- `InputRow`: badge `<span>` → `<button>` with `onFocus/onBlur` for keyboard tooltip access; `<div className="bc-label">` → `<label htmlFor>` via `useId()`; added `aria-invalid`; removed dead `labelStyle`/`disabled` props; added `inputMode` prop (defaults `text`)
- `inputMode="decimal"` applied to purely numeric fields: Current RNG, Current VREL, Tgt Vel (both modes), FA Current RNG, FA Current VREL
- Standalone inputs (Desired Travel Time, Flip Time, Burn Start, Current Time): converted labels to `<label>` elements with `htmlFor`, added `aria-invalid`
- `Readout`: removed dead `dim` prop
- VCRS advisory text: now reports absolute m/s value instead of `%` ratio (which showed "0.0%" when VREL was zero)
- Deleted boilerplate files: `src/App.css`, `src/index.css` (empty), `src/assets/hero.png`, `react.svg`, `vite.svg`
- Removed empty `index.css` import from `main.jsx`

---

## What Was Accomplished (v0.5.3)

**HIGH VCRS WARNING — Absolute Threshold**
Replaced ratio-based check (`vcrsRatioPct > 10`) with flat absolute threshold (`Math.abs(vcrs_mps) > 500`). Warning only fires when VCRS exceeds 500 m/s — below that, RCS handles it mid-burn.

**GAME CLOCK — Requires HH:MM:SS**
`parseGameTime` time-only branch replaced with strict regex `/^(\d{1,2}):(\d{2}):(\d{2})$/`. Partial inputs like `: :`, `12:22:`, and bare `HH:MM` are all rejected. `parseTargetDuration` (duration fields) intentionally left permissive.

**HEADER — Clock Indicator Removed**
Both `bc-status-light clock` spans removed from header JSX.

**REACTANT BUDGET — Tooltip Restored**
Both Burn Plan and Final Approach Reactant Budget fields converted from raw `<div>` + `<input>` to `InputRow` components with tooltip: "Enter the amount of reactant you plan to allocate to this burn. It is not recommended to commit all your available reactant." and `TOOLTIP_IMG_REACTANTBUDGET`.

**MISSING OR INVALID INPUT — Consistent Warning**
Both modes now show matching "MISSING OR INVALID INPUT / One or more fields are empty or non-numeric." warning block when required fields are blank. Burn Plan's old text-list "MISSING FIELDS" warning replaced. Required fields show red border when blank: Current RNG and Current VREL in both modes; Flip Time in Burn Plan.

**MINIMUM THRUST FLOOR (0.01 G)**
Entered acceleration below 0.01 G: red border on input, `NaN` fed to solver, "ACCELERATION BELOW MINIMUM THRUST (0.01 G)" warning shown in both modes. FA constant-burn mode: computed required deceleration below 0.01 G surfaces dedicated error "REQUIRED DECELERATION BELOW MINIMUM THRUST (0.01 G) — CHECK UNITS OR INCREASE RANGE".

**VREL / VCRS Independence Confirmed**
In-game test confirmed the game reports VREL and VCRS as independent axes — no solver correction needed.

---

## Queued But Not Yet Built

*(nothing queued)*

---

## Deferred / Long-Term Items

- Tooltip pass — add tooltips for Desired Travel Time (game day duration explanation) and Flip Time (bare number = seconds). Tooltip images may need to be created.

---