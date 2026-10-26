# Learning Log — Visual Circuit Tutor

Use this document to record concepts you learn, experiments you try, and design decisions you make while building Visual Circuit Tutor.

---

## 1. Core Engineering & Frontend Concepts

### Two-Page View State in React
- **What I learned:** Instead of routing with complex external libraries for simple flows, a top-level state variable (`currentView: 'landing' | 'workspace'`) cleanly switches between the landing/upload view and the workspace view.
- **Why it matters:** The uploaded image file and data URL persist in the parent state (`App.jsx`), so transitioning to the workspace does not lose the image or reload the page.
- **Where to look:** [`src/App.jsx`](../src/App.jsx) (`currentView`, `handleNewProblem`).

### Object URLs & Memory Management
- **What I learned:** When a user selects a file (`File` object), `URL.createObjectURL(file)` generates a temporary URL that the browser can display in an `<img>` tag without uploading it to a server. However, each call creates a browser memory reference that must be freed using `URL.revokeObjectURL(url)` when replacing or unmounting to prevent memory leaks.
- **Where to look:** [`src/App.jsx`](../src/App.jsx) (`handleImageSelected`, `handleImageRemoved`, `useEffect` cleanup).

### Horizontal Parameter & Calculated Value Strips
- **What I learned:** Instead of vertical dashboard cards that consume valuable width, placing controls and outputs in compact horizontal strips above the schematic preserves maximum horizontal space for side-by-side comparison of the circuit and its explanation.
- **Where to look:** [`src/components/WorkspaceParametersStrip.jsx`](../src/components/WorkspaceParametersStrip.jsx) and [`src/components/WorkspaceCalculatedStrip.jsx`](../src/components/WorkspaceCalculatedStrip.jsx).

### 5-Point Pedagogical Explanation Framework
- **What I learned:** Effective engineering explanations should not simply state formulas or final numbers. Every step in this tutor answers five structured questions:
  1. *What are we finding?*
  2. *Which law or formula are we using?*
  3. *Why is that formula appropriate?*
  4. *How do we substitute the values?*
  5. *What does the result mean physically?*
- **Where to look:** [`src/circuit/circuitEngine.js`](../src/circuit/circuitEngine.js) and [`src/components/StepExplainer.jsx`](../src/components/StepExplainer.jsx).

### Robust Viewport Scrolling vs. Rigid 100vh Locking
- **What I learned:** Attempting to force a multi-element workspace to fit exactly into `100vh` using `overflow: hidden` fails on short viewports (like laptops at 768px height or 125% OS scaling), because headers, parameter strips, and explanation text naturally require more height than `100vh` provides. Locking `overflow: hidden` cuts off the bottom of the content permanently.
- **The fix:** Use `min-height: 100vh` on the page shell, remove artificial `overflow: hidden;`, and allow the browser's native document scrollbar to handle overflow. This guarantees that all navigation controls, formula steps, and the bottom of the circuit are always 100% reachable with zero clipping.

### Unified Arrow Stepper Navigation
- **What I learned:** Replacing a row of individual step tab buttons with a single arrow navigation bar (`← Previous       Step 1 of 4       Next →`) simplifies the cognitive load, keeps the learner focused on chronological progress, and eliminates redundant navigation controls.
- **Where to look:** [`src/components/StepExplainer.jsx`](../src/components/StepExplainer.jsx).

---

## 2. Experiments & Exercises I Completed

| Date | Exercise / Change | What Happened | Key Insight |
| :--- | :--- | :--- | :--- |
| 2026-10-26 | Website redesign | Landing upload separated from workspace | Giving upload its own dedicated page created a focused user journey. |
| 2026-10-26 | Horizontal strip layout | Diagram & explainer moved side-by-side | Eliminates vertical scrolling between schematic and explanation. |
| | | | |

---

## 3. Circuit Analysis Notes

### Ohm's Law in a Single Loop
- Formula: $I = \frac{V}{R}$
- Polarity: Conventional current leaves the positive terminal of the voltage source and flows through the circuit towards the negative terminal.
- Power dissipation: $P = V \times I = I^2 \times R = \frac{V^2}{R}$. In a single series resistor, all power supplied by the source is dissipated as heat in the resistor.
- Short Circuit Condition: When $R \to 0$, $I \to \infty$. In practical engineering, circuit breakers or fuses disconnect the circuit before extreme currents cause thermal damage.
