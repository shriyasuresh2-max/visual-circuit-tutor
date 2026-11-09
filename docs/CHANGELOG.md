# Changelog

All notable changes to the Visual Circuit Tutor project are documented in this file.

---

## [Graph-Driven Schematic Layout Rewrite] — 2026-11-04

### Fixed (root causes of the incorrect diagrams)
- **Components were drawn as node-to-node spans.** The old topology fallback placed each component's two terminals directly on two node positions, so a resistor could stretch 400 px across the canvas at an arbitrary angle and there was no room left for wires (`V1: (80,80)→(480,107)`). Components are now fixed-size symbols on a clamped span, and the remaining distance to the node is always wire.
- **The fallback emitted no wires for the loop itself** (a 3-component series circuit produced `Wires: 0`), leaving every terminal visually disconnected. Wires are now generated per electrical node: a 2-member node becomes one wire edge, a 3+-member node becomes a rail anchor with one segment per member.
- **Bus wires started up to 60 px away from their terminal** (floating segments and gaps). Every wire endpoint is now a component terminal or a node anchor by construction.
- **Traced vision-model polylines were rendered verbatim**, which produced diagonals, lost bends, duplicated wires and self-referential wires (`V1.− → V1.−`). Traced polylines are no longer used as geometry; the wires are re-derived from the electrical graph, while component centres, orientations and terminals from the image are still honoured.
- **Symbol leads were computed from the extracted `orientation` while terminals came from the terminal vector**, so leads could point away from the symbol. Leads now derive from the terminal vector, and every symbol's half-extent matches the geometry the SVG actually draws.
- **Junction dots were drawn twice, at node centroids** (mid-air, unrelated to any wire). Junction dots are now drawn once, exactly where a 3+-member node's wires meet; 2-member nodes never get a dot.
- **Component label cards could cover wires and be clipped at the canvas edge.** Labels are re-placed after routing, avoiding symbols, other labels and wire paths, and are always kept fully inside the canvas.

### Added
- `src/circuit/schematicLayout.js` — the single layout pipeline, split by responsibility from `electricalGraph.js`: node anchors → component symbols → orthogonal wire routing → junction/crossing detection → geometric validation.
- `validateSchematic()` replaces the previous "is some wire point near a terminal" check with real rendered-geometry validation: orthogonal segments, terminal contact, no floating endpoints, node continuity in the drawing, distinct nodes never touching, no wire ending on another wire's middle, symbol and label overlap, canvas containment and node-count agreement.
- Conservative connection recovery: when the vision model returns a traced wire whose two terminals appear in no connection at all, that connection is recovered and surfaced as uncertain.
- `src/circuit/schematicLayout.test.js` — 100 invariant-driven tests over 10 topologies (series, parallel, mixed, multiple sources, Wheatstone bridge, shared-branch loops, four orientations, unreliable wires, real Gemini fixture, open circuit), plus direct validator tests for diagonal wires, gaps, accidental T-junctions and interior crossings.

### Changed
- `circuitLayout.js` is now a thin adapter that keeps the existing public API (`layoutCircuit`, `validateRenderedCircuit`, `describeTopology`) over the new engine.
- Tests that asserted the old defective behaviour (components spanning node positions, wire counts derived from traced polylines, crossings taken from declared flags) were rewritten to assert the correct invariants rather than relaxed.

---

## [Google Gemini Vision API Integration] — 2026-10-27

### Changed
- **Vision Backend Migration:** Replaced the OpenAI SDK in `backend/main.py` with Google's official `google-genai` Python SDK.
- **Environment Configuration:** Updated backend to read `GEMINI_API_KEY` from `backend/.env` using `python-dotenv`. Added model configuration via `GEMINI_MODEL` (defaulting to `gemini-2.5-flash`). Updated `backend/.env.example`.
- **Dependencies:** Updated `backend/requirements.txt` to include `google-genai>=2.0.0` and removed `openai`.
- **Structured Schema Compatibility:** Preserved all Pydantic schemas (`CircuitAnalysis`, `Component`, `Connection`, `Terminal`, `CircuitType`, `ComponentType`) and added `is_circuit` alias synchronized with `contains_circuit`.
- **Error Handling:** Implemented structured error mappings for `errors.ClientError` (401/403 for authentication, 429 for quota/rate-limits, 404 for model availability), `errors.ServerError` (503 for temporary service unavailability), and `errors.APIError` (502).

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
