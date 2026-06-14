# CLAUDE.md — Polaris Astronautics Burn Computer

This file provides persistent context for Claude Code sessions on this project.
Read it fully before touching any code.

---

## Project Overview

Single-file React + Vite app (`src/App.jsx`) that calculates flip-and-burn torch drive
trajectories for the game **Ostranauts**. Deployed to GitHub Pages.

**Live URL:** https://bandus.github.io/torch-burn-computer
**Dev server:** `npm run dev` → localhost:5173
**Deploy:** `npm run deploy` (pushes to `gh-pages` branch directly — no GitHub Actions)

---

## Critical Rules — Read Before Every Session

### Change Protocol
1. **Propose before building.** Present a confirmed list of changes and get explicit approval before writing any code. No speculative edits.
2. **Surgical edits only.** Minimize diff size. Never rewrite sections that aren't changing.
3. **Verify math before touching solvers.** Derive and numerically confirm in Node.js before modifying any solver logic. A prior regression was caused by implementing before verifying.
4. **Version numbers require explicit confirmation from Robert.** Do not increment `APP_VERSION` without being asked.

### Before Every Deploy
Always run: `findstr "APP_VERSION" src\App.jsx`
Confirm the version string matches what Robert expects before committing.

### Never Guess Game Mechanics
Robert has caught Claude fabricating Ostranauts-specific mechanics before. Do not assert game implementation details without source confirmation. Ask or say you don't know.

---

## Key Physics Constants (do not change without discussion)

```
G              = 9.80665 m/s²     (standard gravity)
AU             = 149,597,870,700 m
GM             = 1×10⁹ m          (game meter unit)
NO_WAKE_M      = 300,000 m        (300 km no-wake zone)
DAY            = 87,659 s         (Ostranauts game day: 24h + "untime" 24:00:00→24:20:58)
EFFICIENCY_TIME_MULTIPLIER = 2
```

**Why DAY = 87,659 s:** The Ostranauts game clock runs a standard 24-hour day plus an "untime" period. The last displayed second before rollover is 24:20:58 = 87,658 s, making the rollover point 87,659 s. This is NOT a standard 86,400 s day.

---

## Solver & Physics Conventions

- **Acceleration output is always in G** — players cannot set acceleration in m/s² in-game.
- **Minimum thrust floor: 0.01 G** — below this, feed `NaN` to solver and show warning.
- **Signed v0 convention:** closing velocity = positive, receding = negative.
- **parseGameTime** accepts full datetime `YYYY-MM-DD HH:MM:SS` or strict time-only `HH:MM:SS` (regex: `/^(\d{1,2}):(\d{2}):(\d{2})$/`). Bare `HH:MM` is intentionally rejected.
- **parseTargetDuration** (duration fields: Flip Time, Reactant Budget, Desired Travel Time) is intentionally permissive — accepts `4d 3h 2m 37s`, `HH:MM:SS`, bare seconds, etc.
- **VREL and VCRS are independent axes** in-game (confirmed by in-game test). No vector combination needed.
- **High VCRS warning threshold:** `Math.abs(vcrs_mps) > 500` (flat absolute, not ratio-based).

### Implicit Solve Direction (Burn Plan mode)
- Acceleration blank, Travel Time filled → solve for acceleration
- Acceleration filled, Travel Time blank → solve for time (standard)
- Both filled → validate consistency (warn if >1% mismatch)
- Both blank → no output

---

## Architecture Notes

- **Single file:** all logic, styles, and components live in `src/App.jsx`. There is no component directory.
- **Stylesheet** is a template literal injected via `<style>` tag — not a separate CSS file.
- **Tooltip images** are lazy-loaded from `public/tooltips/`: `distance.jpg`, `current-vel.jpg`, `vcrs.jpg`, `reactantbudget.jpg`, `acceleration.jpg`. All five must be present.
- **Subcomponents** `StandoffControl` and `NoWakeToggle` are extracted and shared between Burn Plan and Final Approach modes.
- **ErrorBoundary** wraps the entire app.
- **Boot sequence** uses `sessionStorage` to skip on reload within the same session.
- **Reactant budget** is a constraint layer on top of the two-variable solver — not a peer variable. The three-way solver (time/fuel/accel all peer) is explicitly deferred.

---

## UI Panel Structure

### Left Input Panel (both modes)
1. ◇ Current State
2. ◇ Arrival Parameters
3. ◇ Vessel Parameters
4. ◇ Game Clock

### Right Output Panel
- **Burn Plan:** Burn Solution + Burn Reference (two stacked panels)
- **Final Approach:** Approach Solution

### Bottom (Burn Plan only)
- ◇ Burn Timeline + target cells

---

## CSS Conventions

- `.bc-field-note` — 10px, `--text-secondary`, for captions below inputs
- `.bc-field-note--indent` — adds `padding-left: 118px` to align with input fields
- `--text-dim` — for dimmed computed values shown inside input boxes
- Computed field display (Option 2): computed values show dimmed inside the input box but are NOT written to state — keeps solve direction unambiguous

---

## Patch Notes Format

Patch notes are always titled paragraph prose. Example:

**BOLDED TITLE — Short description**
Item note in plain prose describing what changed and why.

No bullet lists. No sub-bullets. One blank line between items.

---

## Deploy Commands

**Test locally:**
```
npm run dev
```

**Deploy live:**
```
findstr "APP_VERSION" src\App.jsx
git add -A && git commit -m "vX.X.X — description"
npm run deploy
```

**Verify live:** https://bandus.github.io/torch-burn-computer

---

## Current State

See `SESSION_HANDOFF.md` in the project root for what's been built, what's queued,
and any notes about which version of App.jsx is actually in the repo vs. what was
last delivered as an artifact.
