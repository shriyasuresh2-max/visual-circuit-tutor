# Visual Circuit Tutor

**Understand circuits, one step at a time.**

Visual Circuit Tutor is an interactive educational web application that aims to make electrical circuit analysis easier to understand through image-based circuit recognition, electrical graph reconstruction, visual schematics, and step-by-step explanations.

Instead of simply displaying a final numerical answer, the project focuses on helping learners understand how a circuit is interpreted, how its components are connected, and how electrical quantities are calculated.

## Overview

The application allows users to upload an image of an electrical circuit. A vision model analyzes the diagram and extracts information about its components and connections. The extracted information is then processed into an electrical graph and reconstructed as an interactive schematic.

The long-term goal is to connect accurate circuit reconstruction with a verified calculation engine and synchronized visual explanations.

## Current Features

### 1. Circuit Image Upload and Analysis

- Upload circuit diagrams for analysis.
- Backend integration using FastAPI and Google's Gemini API.
- Vision-based identification of electrical components and their visible values.
- Extraction of component terminals and electrical connections.
- Structured analysis responses for frontend processing.
- Support for an optional sample circuit workflow.

### 2. Electrical Graph Reconstruction

The extracted circuit information is converted into an electrical graph.

- Represents components and their terminals.
- Identifies electrical nodes through explicit connections.
- Preserves branches and connectivity relationships.
- Separates electrical connectivity from visual positioning.
- Includes graph validation and reconstruction tests.

The electrical graph acts as the foundation for subsequent circuit analysis.

### 3. Schematic Layout and Rendering

The reconstructed graph is translated into a visual circuit schematic.

- Places electrical components and their terminals.
- Routes wires between connected components.
- Generates junctions and crossing representations.
- Supports schematic positioning and layout adjustments.
- Maintains component terminal relationships during visual edits.
- Includes battery polarity handling and orientation logic.

The layout engine is designed to keep electrical connectivity separate from the visual arrangement of the circuit.

### 4. Interactive Circuit Workspace

The workspace provides an environment for viewing and interacting with reconstructed circuits.

Current editing capabilities include:

- Selecting circuit components.
- Moving components within the schematic.
- Rotating components.
- Selecting wires.
- Selecting and repositioning supported junction nodes.
- Visual rerouting of connections after component movement.
- Resetting the circuit and starting a new problem.

Visual adjustments are handled separately from the underlying electrical graph so that moving a component does not automatically change its electrical connections.

### 5. Circuit Analysis and Learning Interface

The application includes a learning-oriented interface and an existing circuit calculation module.

The project is being developed towards:

- Identifying what a problem asks the learner to calculate.
- Applying appropriate electrical laws and formulas.
- Showing intermediate calculation steps.
- Explaining the physical meaning of calculated values.
- Connecting calculation steps with visual circuit highlights.

The calculation engine and explanation workflow are being expanded alongside the reconstruction system.

## Technology Stack

| Layer | Technologies |
|---|---|
| Frontend | React, Vite, JavaScript |
| Styling | CSS |
| Backend | Python, FastAPI |
| Circuit Recognition | Google Gemini API |
| Circuit Representation | Electrical graph, structured component and connection data |
| Schematic Rendering | SVG |
| Testing | Vitest, Python test scripts |
| Version Control | Git, GitHub |

## Project Architecture

The application is organized into separate stages so that image recognition, electrical connectivity, schematic layout, and rendering can be developed independently.

### Circuit Processing Pipeline

```text
User uploads circuit image
          |
          v
React Frontend
          |
          v
FastAPI Backend
          |
          v
Gemini Vision Analysis
          |
          v
Structured Circuit Data
          |
          v
Electrical Graph Reconstruction
          |
          v
Schematic Layout Engine
          |
          v
Interactive SVG Circuit
```

### Main Components

- **Image Analysis:** Extracts circuit components, values, terminals, and connections from uploaded diagrams.
- **Electrical Graph:** Represents the actual electrical relationships between components.
- **Schematic Layout:** Determines component positions, wire routes, junctions, and crossings.
- **Circuit Renderer:** Displays the reconstructed circuit as an SVG schematic.
- **Interactive Editor:** Allows users to select and visually adjust elements of the reconstructed circuit.
- **Calculation Engine:** Provides the foundation for electrical calculations and subsequent learning explanations.

## Project Structure

```text
visual-circuit-tutor/
│
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   └── .env.example
│
├── docs/
│   └── CHANGELOG.md
│
├── src/
│   ├── App.jsx
│   ├── App.css
│   │
│   ├── circuit/
│   │   ├── circuitEngine.js
│   │   ├── circuitEngine.test.js
│   │   ├── circuitLayout.js
│   │   ├── circuitLayout.test.js
│   │   ├── electricalGraph.js
│   │   ├── electricalGraph.test.js
│   │   ├── schematicLayout.js
│   │   ├── schematicLayout.test.js
│   │   ├── seriesOrientation.test.js
│   │   └── reconstructionEngine.test.js
│   │
│   ├── components/
│   │   ├── AnalysisResultPanel.jsx
│   │   ├── CircuitDiagram.jsx
│   │   ├── LandingPage.jsx
│   │   └── ReferenceViewer.jsx
│   │
│   ├── hooks/
│   │   └── useCircuitAnalysis.js
│   │
│   └── utils/
│       └── sampleCircuit.js
│
├── tests/
│   └── fixtures/
│
├── index.html
├── package.json
├── vite.config.js
└── README.md
```

## Getting Started

### Prerequisites

- Node.js (v18 or higher recommended).
- npm.
- Python 3.10 or higher.
- A Google Gemini API key.

### 1. Clone the Repository

```bash
git clone https://github.com/shriyasuresh2-max/visual-circuit-tutor.git
cd visual-circuit-tutor
```

### 2. Set Up the Frontend

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open the local URL displayed by Vite, usually:

```text
http://localhost:5173
```

### 3. Set Up the Backend

Open another terminal and navigate to the backend directory:

```bash
cd backend
```

Create a virtual environment:

**Windows:**

```powershell
py -m venv .venv
```

**macOS / Linux:**

```bash
python3 -m venv .venv
```

Activate the virtual environment:

**Windows:**

```powershell
.venv\Scripts\activate
```

**macOS / Linux:**

```bash
source .venv/bin/activate
```

Install backend dependencies:

```bash
pip install -r requirements.txt
```

### 4. Configure the Gemini API Key

Create a `.env` file inside the `backend/` directory using `.env.example` as a template.

Add your API key:

```env
GEMINI_API_KEY=your_gemini_api_key
```

Never commit your actual `.env` file or expose your API key publicly.

### 5. Start the Backend Server

From the `backend/` directory:

```bash
uvicorn main:app --reload --port 8000
```

The backend will run at:

```text
http://127.0.0.1:8000
```

Keep both the frontend and backend development servers running while using image analysis.

## Testing

### Frontend Tests

Run the Vitest suite:

```bash
npm test
```

Run tests once without watch mode, if supported by the project script:

```bash
npx vitest run
```

### Production Build

```bash
npm run build
```

### Backend Tests

The repository includes Python test and fixture scripts under `tests/fixtures/`. Some scripts require a running backend and a configured Gemini API key.

## Current Scope and Limitations

Visual Circuit Tutor is an actively developed project. Its reconstruction and editing pipeline is being improved, and the following limitations remain important:

- Image recognition can misidentify components, terminal labels, or connections, particularly in blurry or complex diagrams.
- Reconstructed schematics may require manual visual correction.
- Correct electrical connectivity is a higher priority than visual similarity alone.
- Visual component movement and junction positioning do not yet provide a complete electrical connection-editing workflow.
- Full support for arbitrary circuit topologies and complex networks is still under development.
- A complete interactive electrical simulation with synchronized current and voltage animations is a future development goal.
- Automated recognition and solving should not be treated as guaranteed correct for every uploaded circuit.

## Future Development

Planned improvements include:

1. More reliable circuit image recognition and topology extraction.
2. Better handling of wire crossings, junctions, branches, and complex networks.
3. Editable electrical connections, including creating and deleting wires.
4. A more comprehensive calculation engine for series, parallel, and mixed circuits.
5. Automatic identification of the quantities requested in a problem statement.
6. Step-by-step explanations linked to highlighted circuit components.
7. Interactive simulation of current, voltage, and power.
8. More accurate circuit reconstruction across different diagram styles.

## Project Motivation

Many students learn electrical circuit analysis by memorizing formulas without fully understanding how components interact.

Visual Circuit Tutor is an attempt to bridge that gap by combining computer vision, electrical graph theory, programming, and interactive visualization into one learning experience.

The goal is not just to calculate circuit answers, but to make the reasoning behind them visible.

---

**Built as an ongoing learning and engineering project.**