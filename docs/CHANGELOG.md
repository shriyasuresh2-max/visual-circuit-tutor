# Changelog

All notable changes to the Visual Circuit Tutor project are documented in this file.

---

## [Final-Step Next Button & 3-Part Explanation Refinement] — 2026-10-26

### Changed
- **Final-Step Navigation:** Updated the top-right navigation button in `StepExplainer.jsx` to display "Next →" on every step including the final step. On Step 4, the button appears disabled and prevents navigation beyond the final step.
- **Python Reference Section Removed:** Completely removed the Python code display block and associated styles from all explanation steps.
- **3-Part Educational Explanation:** Restructured each step into:
  - **Part A — What Are We Finding?** (Direct 1-sentence learning objective)
  - **Part B — Work It Out** (Multi-stage progression: Stage 1 Formula, Stage 2 Substitution of known values, Stage 3 Emphasized answer)
  - **Part C — What This Means** (Short, plain-English takeaway explaining physical meaning)
- **Circuit Visual Connection:** Synchronized Step 3 with current-flow arrows and loop path, and Step 4 with the resistor as the heat dissipation component (`HEAT (P)`).

---

## [Workspace Scrolling Fix & Arrow Navigation] — 2026-10-26

### Fixed
- **Cut-Off Workspace and Scrolling:** 
  - Identified root cause: `.workspace-screen` and `.workspace-main-grid` had rigid `height: 100vh; overflow: hidden;` and `height: calc(100vh - 128px); overflow: hidden;` declarations on desktop media queries ($\ge 1024$px), locking the viewport and preventing document scrolling when content exceeded available height.
  - Removed artificial viewport locking and inner grid clipping. Applied `min-height: 100vh` to the application shell and enabled natural document-level vertical scrolling.
  - Both panels (circuit schematic and explanation) and all navigation controls are now 100% reachable without any content clipping on standard and short viewports alike.
  - Set `align-items: start;` and `minmax(0, ...)` on columns to prevent grid container blowouts.

### Changed
- **Step Navigation in `StepExplainer.jsx`:**
  - Replaced the row of individual step tab buttons (`Step 1`, `Step 2`, `Step 3`, `Step 4`) with a unified arrow navigation bar: `← Previous       Step 1 of 4       Next →`.
  - Added compact, accessible arrow buttons with tooltips and disabled states at boundaries (Step 1 disables Previous; Step 4 disables Next/shows Completed).
  - Maintained synchronization with keyboard arrow keys ($\leftarrow$ and $\rightarrow$) and SVG component click-to-step navigation.
  - Removed duplicate bottom navigation footer row.

---

## [Complete Website Redesign] — 2026-10-26

### Added
- **Two-Page User Journey:**
  - **Page One (Landing and Upload):** Dedicated landing page with headline *"Understand circuits, one step at a time."*, prominent central drag-and-drop file upload, file preview with replace functionality, *"Continue to workspace"* primary action, and a secondary *"Try a sample circuit"* option.
  - **Page Two (Circuit Learning Workspace):** Dedicated interactive learning interface with no dashboard clutter.
- **Top Horizontal Strips in Workspace:**
  - `WorkspaceParametersStrip`: Replaced vertical sidebar cards with a unified horizontal strip across the top for Voltage ($V$) and Resistance ($R$) inputs and sliders.
  - `WorkspaceCalculatedStrip`: Replaced four oversized cards with a compact horizontal data strip showing Voltage, Resistance, Current, and Power.
- **5-Point Pedagogical Explanation Framework in `StepExplainer.jsx`:**
  - Each step systematically answers:
    1. *What are we finding?*
    2. *Which law or formula are we using?*
    3. *Why is that formula appropriate?*
    4. *How do we substitute the values?*
    5. *What does the result mean physically?*
- **Expandable Reference Viewer:** Added `ReferenceViewer.jsx` allowing learners to inspect their uploaded problem in a non-disruptive drawer without displacing the side-by-side workspace.
- **Sample Circuit Utility:** Extracted `src/utils/sampleCircuit.js` to generate vector sample problems for testing and demo flows.

### Changed
- **Workspace Layout:** Enforced a dedicated two-column desktop layout below the parameter/result strips:
  - Left column ($\approx 58\%$): Large vector SVG schematic.
  - Right column ($\approx 42\%$): Step-by-step educational explainer with internal scrolling.
  - Both areas remain locked side by side on desktop without requiring vertical page scrolling.
- **Navigation Flow:**
  - Added *"New Problem"* action in the workspace header to easily return to the upload landing page.
  - Retained keyboard navigation ($\leftarrow$ / $\rightarrow$) and direct schematic click-to-step navigation.

### Removed
- Removed the dashboard-style left sidebar layout.
- Removed all remnants of dashboard cards and artificial status meters.

---

## [UI Refinement & Desktop Layout Fix] — 2026-10-26

### Added
- 3-area layout prototype and initial technical slate theme tokens.
- Header reset control.
- Documentation suite (`README.md`, `PROJECT_PLAN.md`, `CHANGELOG.md`, `LEARNING_LOG.md`).

### Changed
- Replaced neon glow filters with clean vector schematic strokes.
- Removed marketing badges (*"Milestone 1"*, *"Interactive SVG Engine"*, *"Ohm's Law Solver"*, *"Demo Mode Active"*).
- Removed the Quick Presets section.

---

## [Milestone 1 Initial Prototype] — 2026-10-26

### Added
- Project initialization with Vite, React 19, and Vitest.
- Pure calculation engine (`circuitEngine.js`) calculating $I = V / R$ and $P = V \times I$ with input validation.
- 9 unit tests verifying mathematical accuracy and edge cases.
- Initial SVG schematic with battery, resistor, and current arrows.
