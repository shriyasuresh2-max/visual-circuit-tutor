# Visual Circuit Tutor

An interactive educational website designed to teach electrical circuit analysis visually through synchronized vector schematics and step-by-step reasoning. Inspired by the educational philosophy of [VisuAlgo](https://visualgo.net/).

---

## User Flow & Core Features

### 1. Page One — Landing & Problem Upload
- **Focused Landing Experience:** Generous whitespace, clean typography, and a prominent headline: *"Understand circuits, one step at a time."*
- **Central Upload Zone:** Drag-and-drop or browse files (supports PNG, JPG, and WebP).
- **Instant Preview & Actions:** Selected image preview with file details, "Replace image", and a primary **"Continue to workspace"** button.
- **Sample Circuit Option:** A secondary **"Try a sample circuit"** action that preloads an ideal DC series problem for instant testing.
- **Honest Limitation Note:** Clearly informs learners that image recognition is in active development; uploaded diagrams serve as visual references alongside the interactive solver.

### 2. Page Two — Circuit Learning Workspace
- **Compact Workspace Header:** Unobtrusive top bar featuring the product name, topic indicator, **"Reference Image"** drawer toggle, **"Reset Circuit"** button, and **"New Problem"** action to return to upload.
- **Horizontal Circuit Parameters Strip:** Voltage ($V$) and Resistance ($R$) inputs and range sliders arranged horizontally with compact bounds and inline short-circuit validation.
- **Horizontal Calculated Values Strip:** Compact row presenting Voltage ($12\text{ V}$), Resistance ($4\ \Omega$), Current ($I = 3\text{ A}$), and Power ($P = 36\text{ W}$) without oversized dashboard cards.
- **Side-by-Side Learning Area (Desktop):**
  - **Circuit Schematic ($\approx 58\%$ width):** Vector SVG diagram with battery symbol, polarity, ANSI zigzag resistor, conventional current arrows, dynamic step highlights, and click-to-step component navigation.
  - **Step-by-Step Explanation ($\approx 42\%$ width):** A 5-point structured educational breakdown:
    1. *What are we finding?* (Clear objective)
    2. *Which law or formula are we using?* (Physics principle)
    3. *Why is that formula appropriate?* (Engineering rationale)
    4. *How do we substitute values?* (Mathematical substitution)
    5. *What does the result mean physically?* (Current direction & energy conversion)
    - Includes Python reference code (`circuit_calculator.py`) and keyboard navigation ($\leftarrow$ / $\rightarrow$).
- **Expandable Reference Drawer:** View the uploaded textbook problem diagram without disrupting the side-by-side workspace.

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
    ├── App.jsx                          # Main state orchestrator & page routing
    ├── App.css                          # Landing & workspace styles
    ├── circuit/
    │   ├── circuitEngine.js             # Pure Ohm's law & series circuit solver
    │   └── circuitEngine.test.js        # Vitest automated test suite (9 tests)
    ├── utils/
    │   └── sampleCircuit.js             # Sample textbook problem SVG generator
    └── components/
        ├── LandingPage.jsx              # Page One: Dedicated landing & upload
        ├── WorkspaceHeader.jsx          # Page Two: Header with New Problem & Reset
        ├── WorkspaceParametersStrip.jsx # Page Two: Horizontal parameters toolbar
        ├── WorkspaceCalculatedStrip.jsx # Page Two: Horizontal calculated values strip
        ├── CircuitDiagram.jsx           # Technical SVG schematic with step focus
        ├── StepExplainer.jsx            # 5-point pedagogical explanation panel
        └── ReferenceViewer.jsx          # Expandable reference image drawer
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
Open `http://localhost:5173` in your browser.

### Running Automated Tests
```bash
npm test
```
To run tests in watch mode:
```bash
npm run test:watch
```

### Production Build
```bash
npm run build
```

---

## Current Scope & Limitations

- **Ideal DC Series Circuit:** Milestone 1 models a single closed loop with one ideal DC voltage source and one resistor. Multi-resistor series/parallel networks and Kirchhoff's laws are planned for subsequent milestones.
- **Image Recognition Status:** Uploaded diagrams are currently rendered as a reference image for the user. Automated optical diagram recognition (OCR + computer vision netlist extraction) is planned for a future milestone.
