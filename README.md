# Visual Circuit Tutor

An interactive educational engineering tool designed to teach electrical circuit analysis visually through synchronized vector schematics and step-by-step reasoning. Inspired by the educational philosophy of [VisuAlgo](https://visualgo.net/).

---

## Current Functionality

- **Side-by-Side Educational Workspace:** A 3-area desktop layout placing the circuit schematic and active step-by-step reasoning side by side without vertical scrolling:
  - **Area A (Left Sidebar):** Circuit parameters ($V$ and $R$ inputs/sliders), calculated values readout ($V, R, I, P$), and textbook diagram image uploader.
  - **Area B (Center):** Vector SVG schematic with ideal DC battery, ANSI zigzag resistor, conventional current arrows, and synchronized component highlighting.
  - **Area C (Right):** Stepper card presenting 4 progressive reasoning steps, mathematical formula display, conceptual explanation, and Python code reference.
- **Ohm's Law Calculation Engine:** Fully decoupled pure calculation module in `src/circuit/circuitEngine.js` calculating $I = \frac{V}{R}$ and power $P = V \times I$.
- **Circuit Validation & Edge Cases:** Flags short circuits ($R = 0\ \Omega \implies I \to \infty$), rejects negative resistances, and safely handles invalid numeric inputs.
- **Interactive Component Selection:** Clicking on the battery, resistor, loop, or current arrow in the SVG schematic immediately focuses that explanation step.
- **Keyboard Navigation:** Use $\leftarrow$ and $\rightarrow$ arrow keys to step through the lesson.
- **Textbook Image Reference:** Upload PNG, JPG, or WebP diagrams with instant local preview, file size reporting, and replacement/removal controls.
- **Automated Tests:** 9 unit tests with Vitest verifying calculations, formatting, edge cases, and string inputs.

---

## Project Structure

```
visual-circuit-tutor/
├── index.html                           # App entry HTML
├── package.json                         # Dependencies & scripts
├── vite.config.js                       # Vite and Vitest configuration
├── circuit_calculator.py                # Reference Python script
├── README.md                            # Project overview & documentation
├── docs/
│   ├── PROJECT_PLAN.md                  # Vision, roadmap & architecture
│   ├── CHANGELOG.md                     # Implementation log & visual refinements
│   └── LEARNING_LOG.md                  # Starter template for student notes
└── src/
    ├── main.jsx                         # React root entry point
    ├── index.css                        # Design tokens & base styles
    ├── App.jsx                          # Main workspace orchestrator
    ├── App.css                          # 3-area desktop grid & responsive styles
    ├── circuit/
    │   ├── circuitEngine.js             # Pure Ohm's law & series circuit solver
    │   └── circuitEngine.test.js        # Vitest automated test suite
    └── components/
        ├── Header.jsx                   # Minimal app header bar with reset button
        ├── CircuitControls.jsx          # Voltage & Resistance inputs with validation
        ├── MetricsSummary.jsx           # Compact readout tiles (V, R, I, P)
        ├── ImageUploader.jsx            # Textbook reference upload & preview
        ├── CircuitDiagram.jsx           # Technical SVG schematic & step highlights
        └── StepExplainer.jsx            # Stepper card with math & Python bridge
```

---

## Getting Started

### Prerequisites
- Node.js (v18 or higher recommended)
- npm or pnpm

### Installation
```bash
npm install
```

### Development Server
```bash
npm run dev
```
Open `http://localhost:5173` in your web browser.

### Running Unit Tests
```bash
npm test
```
To run tests in interactive watch mode:
```bash
npm run test:watch
```

### Production Build
```bash
npm run build
```

---

## Current Scope & Limitations

- **Single Series Circuit:** Currently models a single-loop closed DC circuit with one ideal voltage source and one resistor. Parallel branches, multiple loops, capacitors, and inductors are planned for future milestones.
- **Image Upload:** Uploaded circuit diagrams are rendered locally for human visual reference. Automated optical diagram extraction (using computer vision or multimodal AI) is reserved for a future milestone.
