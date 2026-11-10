# Visual Circuit Tutor

**An interactive circuit learning tool that turns circuit diagrams into editable, understandable schematics.**

Visual Circuit Tutor is a web application designed to help students understand electrical circuits from images. Instead of manually rebuilding a circuit, users can upload a circuit diagram and let AI identify its components and connections.

The project focuses on making circuit diagrams easier to inspect, edit, and understand through visual reconstruction.

---

## Overview

Understanding an electrical circuit involves more than identifying its components. Students also need to understand how those components are connected, how current flows through the circuit, and how the circuit can be represented as an electrical network.

Visual Circuit Tutor aims to simplify this process.

The application takes an uploaded circuit image, uses AI-powered image understanding to extract its structure, and reconstructs it as an interactive schematic.

The long-term goal is to combine accurate circuit recognition, a reliable electrical calculation engine, and interactive visual explanations into one learning platform.

## Features

### Circuit Image Upload
- Upload circuit diagrams as images.
- Analyze uploaded diagrams using AI-powered image recognition.
- Extract component information and electrical connections.

### Circuit Reconstruction
- Convert recognized circuit information into a structured electrical graph.
- Reconstruct the circuit as a schematic.
- Represent components, terminals, wires, junctions, and crossings.
- Keep electrical connectivity separate from visual positioning.

### Interactive Circuit Editor
- Move circuit components.
- Drag junctions to adjust their positions.
- Move wire segments to change the visual routing.
- Drag wire endpoints and preview possible snap targets.
- Snap previews identify nearby terminals, junctions, and wire segments.
- Reroute connected wires when components or junctions are moved.

### Circuit Validation
- Validate electrical connectivity.
- Distinguish actual junctions from wire crossings.
- Detect incomplete or invalid schematic structures.
- Re-evaluate the reconstructed layout after edits.

### Stability and Editing
- Preserve junction positions when unrelated wires are edited.
- Keep connected wires aligned with their electrical nodes.
- Prevent visual edits from unintentionally changing the underlying electrical graph.

---

## How It Works

The application follows a modular pipeline:

```text
       Circuit Image
             |
             v
    AI Image Recognition
             |
             v
   Component & Connection
        Extraction
             |
             v
     Electrical Graph
             |
             v
      Schematic Layout
             |
             v
    Interactive Circuit UI
```

### 1. Image Recognition

The uploaded image is processed using Google's Gemini API to identify circuit components, their properties, and their connections.

### 2. Electrical Graph Construction

The extracted information is converted into an electrical graph.

This graph represents the actual connectivity of the circuit, independently of how the circuit is displayed on screen.

### 3. Schematic Layout

The layout engine positions components, terminals, junctions, and wires to produce a readable circuit diagram.

It also handles wire routing, junction positioning, and visual crossings.

### 4. Interactive Rendering

The reconstructed circuit is displayed in the React frontend.

Users can interact with components, junctions, and wires while the application maintains the underlying electrical structure.

---

## Tech Stack

| Technology | Purpose |
|---|---|
| React | Frontend user interface |
| Vite | Frontend development and build tooling |
| JavaScript | Application logic |
| Python | Backend logic |
| FastAPI | Backend API |
| Google Gemini API | Circuit image recognition |
| SVG | Interactive circuit rendering |
| Vitest | Unit testing |

---

## Project Structure

```text
visual-circuit-tutor/
│
├── backend/
│   └── main.py
│
├── src/
│   ├── circuit/
│   │   ├── electricalGraph.js
│   │   ├── circuitLayout.js
│   │   ├── schematicLayout.js
│   │   └── wireSnap.js
│   │
│   ├── components/
│   │   ├── CircuitDiagram.jsx
│   │   ├── LandingPage.jsx
│   │   └── ...
│   │
│   ├── hooks/
│   │   └── ...
│   │
│   ├── App.jsx
│   └── main.jsx
│
├── tests/
├── package.json
└── README.md
```

---

## Getting Started

Follow these instructions to run the project locally.

### Prerequisites

Make sure you have installed:

- Node.js and npm
- Python 3
- Git
- A Google Gemini API key

### 1. Clone the Repository

```bash
git clone https://github.com/shriyasuresh2-max/visual-circuit-tutor.git
```

Navigate into the project:

```bash
cd visual-circuit-tutor
```

### 2. Set Up the Frontend

Install the dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

The frontend should be available at:

```text
http://localhost:5173
```

### 3. Set Up the Backend

Open a separate terminal and navigate to the backend:

```bash
cd backend
```

Create a Python virtual environment:

```bash
py -m venv .venv
```

Activate it in PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

Install the backend dependencies:

```bash
pip install -r requirements.txt
```

### 4. Configure the Gemini API Key

Create a `.env` file inside the `backend` directory and add your Gemini API key using the environment variable expected by the backend.

Do not commit your `.env` file or expose your API key publicly.

### 5. Start the Backend

From the `backend` directory:

```bash
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000
```

The backend should be available at:

```text
http://127.0.0.1:8000
```

Keep both the frontend and backend running while using the application.

---

## Running Tests

The project uses Vitest for testing circuit graph construction, schematic layout, wire snapping, and editing behavior.

Run the test suite:

```bash
npm test
```

Create a production build:

```bash
npm run build
```

---

## Design Principles

The project is being developed around a few important principles:

**1. Electrical correctness comes first**

A circuit must preserve its actual electrical connections. A visually attractive diagram is not useful if its topology is incorrect.

**2. Connectivity and geometry are separate**

Moving a component or changing a wire's visual route should not accidentally change the electrical graph.

**3. General-purpose reconstruction**

The system should work with different circuit diagrams rather than relying on hardcoded component positions, circuit IDs, or specific example topologies.

**4. Modular architecture**

Image recognition, graph construction, schematic layout, rendering, and electrical calculations should remain separate so that each part can be improved independently.

**5. Visual learning**

The goal is not simply to display an answer. The application should eventually help students understand how a circuit works through interactive explanations and visual feedback.

---

## Current Development Status

Visual Circuit Tutor is an active work in progress.

### Implemented

- Circuit image upload and AI-based analysis pipeline.
- Electrical graph construction.
- Component and terminal representation.
- Schematic reconstruction and wire routing.
- Interactive component movement.
- Junction movement and wire rerouting.
- Wire segment dragging.
- Wire endpoint snap-target detection and visual previews.
- Circuit layout validation.
- Regression tests for graph, layout, snapping, and editing behavior.

### Planned

- Improve recognition accuracy for complex and handwritten circuit diagrams.
- Support more complicated circuit topologies.
- Allow users to correct incorrectly recognized electrical connections.
- Build a reliable Python-based electrical calculation engine.
- Support series and parallel resistor circuit calculations.
- Accept the actual circuit question alongside the uploaded image.
- Generate step-by-step explanations based on verified calculations.
- Add interactive current-flow and voltage visualizations.
- Introduce circuit simulation and animated explanations.

These are planned capabilities and should not be considered fully implemented yet.

---

## Project Goal

The long-term vision is to create an interactive learning environment where students can upload an electrical circuit, understand its structure, correct recognition mistakes, solve the problem, and visualize the reasoning behind the solution.

Rather than treating circuit solving as a final numerical answer, Visual Circuit Tutor aims to make the entire process of understanding a circuit more visual and intuitive.

---

## Author

**Shriya Suresh**

GitHub: [@shriyasuresh2-max](https://github.com/shriyasuresh2-max)

---

*Visual Circuit Tutor is an independently developed project currently under active development.*