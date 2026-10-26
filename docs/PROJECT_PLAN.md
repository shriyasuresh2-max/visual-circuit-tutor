# Visual Circuit Tutor — Project Plan

## 1. Project Vision

Visual Circuit Tutor is an interactive educational tool designed to help engineering and computer science students understand electrical circuit analysis. Inspired by tools like **VisuAlgo** and **PhET**, its objective is to bridge abstract algebraic formulas ($V = IR$, KVL, KCL) with intuitive vector schematics and synchronized step-by-step reasoning.

---

## 2. Core Architecture Principles

1. **Separation of Physics and Interface:**
   All circuit equations, validation constraints, and step derivations are implemented in pure JavaScript modules (`src/circuit/`) with zero UI dependencies. This ensures circuit logic can be unit-tested thoroughly without mounting DOM elements.

2. **Synchronized Visual Feedback:**
   Every step in the tutor highlights the corresponding physical component or node in the circuit schematic, eliminating the cognitive gap between equation variables and circuit topology.

3. **Restrained Engineering Design:**
   High-contrast, functional design with subtle borders and clear typography. Avoids distracting neon glows or artificial dashboard badges in favor of direct scientific clarity.

4. **Non-blocking Desktop Layout:**
   The circuit visualization and the active step reasoning must be visible side by side on desktop and laptop screens so learners never have to scroll between the diagram and the explanation.

---

## 3. Milestones & Roadmap

### Milestone 1: Single-Loop DC Circuit & Dedicated Website Flow (Completed)
- [x] Pure calculation engine implementing Ohm's Law ($I = \frac{V}{R}$) and Power ($P = V \times I$).
- [x] Input validation for zero resistance ($R = 0 \implies \text{short circuit}$), negative resistance, and non-numeric inputs.
- [x] Automated unit test suite with 9 test cases in Vitest.
- [x] Dedicated Page One: Landing and problem upload with preview, replace, and sample circuit action.
- [x] Dedicated Page Two: Circuit Learning Workspace with horizontal parameter & calculated value strips.
- [x] Side-by-side desktop layout: Vector SVG schematic ($\approx 58\%$) and Step Explainer ($\approx 42\%$).
- [x] 5-point pedagogical explanation framework answering what we find, law used, engineering rationale, value substitution, and physical meaning.
- [x] Vector SVG schematic with ideal DC battery, ANSI zigzag resistor, conventional current flow, and step-synchronized highlighting.
- [x] Interactive click-to-step navigation on schematic components.
- [x] Keyboard arrow navigation ($\leftarrow$ / $\rightarrow$).
- [x] Expandable reference image drawer for uploaded textbook problems.

### Milestone 2: Series & Parallel Resistor Networks (Upcoming)
- [ ] Multiple resistors in series ($R_{eq} = R_1 + R_2 + \dots$).
- [ ] Resistors in parallel ($R_{eq} = \frac{1}{\sum \frac{1}{R_i}}$).
- [ ] Voltage Divider Rule (VDR) and Current Divider Rule (CDR) visualizers.
- [ ] Interactive toggle to add/remove branches in SVG.

### Milestone 3: Multi-Loop Analysis & Kirchhoff's Laws (Planned)
- [ ] Kirchhoff's Current Law (KCL) at circuit nodes.
- [ ] Kirchhoff's Voltage Law (KVL) around independent loops.
- [ ] Matrix equation solver (Mesh Analysis & Nodal Analysis) with step-by-step Gaussian elimination display.

### Milestone 4: Textbook Image Recognition (Future)
- [ ] Integration of Computer Vision / Multimodal LLM pipeline.
- [ ] Optical circuit extraction: detecting voltage sources, ground nodes, resistors, and wire junctions from textbook photos.
- [ ] Conversion of detected topologies into an internal SPICE/netlist graph to feed the visualization engine.
