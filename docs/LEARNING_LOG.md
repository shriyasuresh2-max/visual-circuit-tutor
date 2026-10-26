# Learning Log — Visual Circuit Tutor

Use this document to record concepts you learn, experiments you try, and design decisions you make while building Visual Circuit Tutor.

---

## 1. Core Engineering & Frontend Concepts

### React State vs. Python Variables
- **What I learned:** In Python (`circuit_calculator.py`), variables hold static values that execute sequentially from top to bottom. In React (`useState`), updating a state variable (`setVoltage(24)`) automatically schedules a re-render of all components that consume that value.
- **Where to look:** [`src/App.jsx`](../src/App.jsx) (`voltage`, `resistance`, `activeStep`).

### Decoupling Logic from the UI (Pure Functions)
- **What I learned:** The physics calculation engine (`circuitEngine.js`) doesn't import React or touch HTML elements. It accepts numbers and returns plain objects and formatted strings. This makes it possible to test circuit math with 9 automated Vitest tests in under 15 milliseconds without launching a browser.
- **Where to look:** [`src/circuit/circuitEngine.js`](../src/circuit/circuitEngine.js) and [`src/circuit/circuitEngine.test.js`](../src/circuit/circuitEngine.test.js).

### SVG Coordinate Systems & Responsive ViewBoxes
- **What I learned:** SVGs use internal coordinate spaces defined by `viewBox="minX minY width height"`. By setting `viewBox="0 0 540 360"` and `width="100%" height="auto"`, the schematic scales to fit any column width while maintaining crisp vector lines and correct component aspect ratios.
- **Where to look:** [`src/components/CircuitDiagram.jsx`](../src/components/CircuitDiagram.jsx).

### 3-Area Desktop Layout without Scrolling
- **What I learned:** By using CSS Grid with `grid-template-columns: 290px minmax(360px, 1.15fr) minmax(320px, 1fr)` and giving Area C (Explainer) and Area A (Controls) internal scrolling (`overflow-y: auto`), the circuit diagram (Area B) and explanation (Area C) remain visible side by side on laptop screens without the page scrolling between them.
- **Where to look:** [`src/App.css`](../src/App.css).

---

## 2. Experiments & Exercises I Completed

| Date | Exercise / Change | What Happened | Key Insight |
| :--- | :--- | :--- | :--- |
| YYYY-MM-DD | Example: Changed resistor color in CSS | Resistor turned coral orange on Step 2 | CSS variables pass down to SVG stroke properties. |
| | | | |
| | | | |

---

## 3. Circuit Analysis Notes

### Ohm's Law in a Single Loop
- Formula: $I = \frac{V}{R}$
- Polarity: Conventional current leaves the positive terminal of the voltage source and flows through the circuit towards the negative terminal.
- Power dissipation: $P = V \times I = I^2 \times R = \frac{V^2}{R}$. In a single series resistor, all power supplied by the source is dissipated as heat in the resistor.
- Short Circuit Condition: When $R \to 0$, $I \to \infty$. In practical engineering, circuit breakers or fuses disconnect the circuit before extreme currents cause thermal damage.

---

## 4. Questions to Explore for Next Milestones
- [ ] How do we model two resistors in series ($R_1 + R_2$)?
- [ ] How do we calculate parallel branches where current divides ($I_1 + I_2 = I_{total}$)?
- [ ] How can we use canvas or SVG drag-and-drop to let users draw circuits?
- [ ] How will computer vision or an LLM convert an uploaded image of a circuit into nodes and edges?
