# Changelog

All notable changes to the Visual Circuit Tutor project are documented in this file.

---

## [UI Refinement & Desktop Layout Fix] — 2026-10-26

### Added
- **3-Area Desktop Grid:** Implemented a non-scrolling desktop layout dividing the workspace into:
  - **Area A (Left Sidebar):** Compact controls, live calculation metrics, and textbook image reference.
  - **Area B (Center):** Vector circuit schematic.
  - **Area C (Right):** Synchronized step-by-step reasoning panel.
  - Area B and Area C now sit directly side by side, visible simultaneously on standard laptop screens ($\ge 1024$px).
- **Responsive Breakpoints:** Added a 2-column layout for tablets (768px - 1023px) and a stacked mobile layout (< 768px) where the diagram and explainer take precedence.
- **Header Reset Control:** Added a clean `Reset Circuit` button directly in the header bar.
- **Documentation Suite:** Created `README.md`, `docs/PROJECT_PLAN.md`, `docs/CHANGELOG.md`, and `docs/LEARNING_LOG.md`.

### Changed
- **Visual Design Refinement:**
  - Replaced overly AI-generated neon glowing drop-shadows with crisp, clean engineering stroke highlights.
  - Replaced multi-color gradient panels with subtle, restrained dark slate surfaces (`#121824`, `#172030`) and crisp 1px borders (`#1e293b`).
  - Streamlined typography: clear sans-serif for UI labels and monospace for equations and physical values.
- **SVG Schematic Rendering:**
  - Removed heavy `<filter>` drop-shadows (`glow-cyan`, `glow-amber`, `glow-violet`, `glow-emerald`).
  - Added clean bounding boxes and crisp stroke changes for focused components.
  - Standardized marker arrows and subtle conductor current dashes.
- **Image Reference Box:**
  - Reduced dropzone height and simplified layout to fit Area A comfortably.
  - Replaced large demo banner with a transparent, honest note: *"Reference preview only. Automated circuit extraction is in development."*

### Removed
- Removed decorative and technical marketing badges:
  - `"Milestone 1"`
  - `"Interactive SVG Engine"`
  - `"Ohm's Law Solver"`
  - `"Demo Mode Active"`
  - `"Pre-calibrated Sample Circuit"`
  - `"Highlighted in Diagram"`
  - `"Preview Mode"`
- Removed the **Quick Presets** section to keep the controls area focused and compact.
- Removed the top `DemoBanner` element that was pushing the schematic and explainer down the viewport.

---

## [Milestone 1 Initial Prototype] — 2026-10-26

### Added
- Initial project setup with Vite, React 19, and Vitest.
- Pure calculation engine (`circuitEngine.js`) calculating $I = V / R$ and $P = V \times I$ with input validation ($R \le 0$, negative $R$, non-numbers).
- 9 automated unit tests verifying calculations and boundary conditions.
- Vector SVG schematic with DC battery and zigzag resistor.
- 4-step progressive tutor with formula display and Python reference mapping to `circuit_calculator.py`.
- Image upload and preview with sample problem generator.
