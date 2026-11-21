# Visual Circuit Tutor

Visual Circuit Tutor turns uploaded circuit diagrams into editable SVG schematics and interactive lessons. It uses Google Gemini to read the image, then explains supported DC circuits through five analysis methods.

## Features

- Upload a PNG, JPEG, or WebP circuit image up to 5 MiB. Gemini extracts components, printed values, terminals, and connections.
- Review the reconstructed schematic and its validation messages. The reconstruction distinguishes junctions from crossings and flags incomplete or disputed connections.
- Adjust component values and schematic geometry. You can move components, junctions, and wire segments. Wire endpoint handles preview snap targets, and geometry edits preserve the electrical graph.
- Solve ideal DC resistor networks with independent voltage and current sources. The solver calculates node voltages, voltage drops, and branch currents.
- Ask a supported question, such as **What is the current through R2?** or **What is the power dissipated by R1?** Other supported requests include resistor voltage, current supplied by a named source, individual node voltages, all node voltages or branch currents, and general nodal analysis.
- Follow a step-by-step lesson with KaTeX equations, circuit highlights, current-direction arrows, and animated conventional-current flow. Nodal Analysis is the default method. Reduced-motion preferences keep the static arrows and disable continuous animation.

## How it works

1. **Extract.** The React frontend sends the image to FastAPI at `POST /api/analyze-image`. The backend sends it to Gemini and returns structured circuit evidence.
2. **Reconstruct.** The frontend reconciles that evidence into an electrical graph and lays it out as an SVG schematic. Connectivity comes from the graph, which keeps visual editing independent of electrical connections.
3. **Solve.** Select **Continue to workspace**, review the circuit, and choose **Solve Circuit**. Choose an analysis method. The solver uses the circuit graph and component values to compute the result. If a value is missing or unreadable, use **Edit component values** and solve again. Disputed or incomplete connectivity blocks solving.
4. **Learn.** Follow the selected method from its setup to the requested calculation. Change the method to study the same circuit from another perspective. **Previous Step** and **Next Step** update the lesson and diagram together.

## Analysis methods

| Method | What the lesson shows |
| --- | --- |
| Nodal Analysis | Reference and unknown node voltages, KCL equations, supernode constraints where applicable, and the requested calculation. |
| Mesh Analysis | Mesh-current directions and loop equations, with supermesh and current-source constraints where applicable. Verified loop arrows link currents to the schematic. |
| Series-Parallel Reduction | Valid series and parallel resistor combinations, equivalent resistance, and recovery of original circuit quantities where supported. |
| Source Transformation | One step per valid voltage-source/series-resistor or current-source/parallel-resistor conversion, with verified before-and-after diagrams when available. The lesson follows with applicable reductions and can recover a quantity inside a transformed pair from the solved terminal voltage. |
| Superposition | One step per independent source. Inactive voltage sources become shorts and inactive current sources become opens. The lesson adds signed contributions, checks the total against a direct nodal solve, and calculates power from the final voltage and current. |

## Tech stack

| Technology | Role |
| --- | --- |
| React 19, JavaScript, and Vite | Frontend and development tooling |
| SVG | Schematic rendering and editing |
| Python and FastAPI | Image upload and analysis API |
| Google Gemini API | Image-based circuit extraction |
| JavaScript DC solvers | Modified nodal analysis (MNA) and method-specific solvers and checks |
| KaTeX | Mathematical notation in lessons |
| Vitest and Python `unittest` | Frontend and backend regression tests |

## Project structure

| Path | Contents |
| --- | --- |
| `backend/main.py` | FastAPI app, Gemini configuration, and extraction validation |
| `src/circuit/` | Graph construction, schematic layout, value parsing, solving, and lesson logic |
| `src/components/` | Upload, schematic editor, solve panel, and lesson interface |
| `src/hooks/useCircuitAnalysis.js` | Image upload and analysis request handling |
| `tests/` | Backend tests and shared regression fixtures |

## Run locally

Install Git, Node.js 22.12 or newer with npm, and Python 3.13. A Gemini API key is required for live image analysis.

### 1. Clone and install frontend dependencies

```bash
git clone https://github.com/shriyasuresh2-max/visual-circuit-tutor.git
cd visual-circuit-tutor
npm ci
```

If PowerShell blocks the npm script shim, use `npm.cmd` in place of `npm`.

### 2. Create the backend environment

Run these commands from the repository root. They use the virtual environment directly, so activation is optional.

**Windows PowerShell**

```powershell
py -3.13 -m venv backend/.venv
.\backend\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
if (-not (Test-Path backend/.env)) {
    Copy-Item backend/.env.example backend/.env
}
```

**macOS or Linux**

```bash
python3.13 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
fi
```

If `backend/.env` already exists, keep it and update it directly. Set the following variable using your own key.

```dotenv
GEMINI_API_KEY=your_gemini_api_key_here
```

`GEMINI_MODEL` is optional and defaults to `gemini-3.5-flash-lite`. Keep the model from the example file or set a model that supports image input and structured JSON and is available to your key. Keep `backend/.env` and its key out of Git.

### 3. Start the backend

From the repository root, run the command for your platform and leave the terminal open.

**Windows PowerShell**

```powershell
.\backend\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

**macOS or Linux**

```bash
backend/.venv/bin/python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

The backend health endpoint is `http://127.0.0.1:8000/api/health`. A response with `gemini_configured: true` confirms that a key value is present. Live image analysis verifies whether it can use the selected model.

### 4. Start the frontend

Open a second terminal in the repository root.

```bash
npm run dev
```

Open `http://localhost:5173`, or the local URL printed by Vite. Keep the backend on `127.0.0.1:8000` for this setup because the current frontend targets that address.

## Tests and production build

Run from the repository root. Regression tests use local fixtures and require no live Gemini request. The latest implementation check passed 665 frontend tests, 8 backend tests, and the production build. The build reports a bundle-size warning.

```bash
npm test
npm run build
```

The production frontend build is written to `dist/`. Run the Python backend suite with the interpreter from the virtual environment.

**Windows PowerShell**

```powershell
.\backend\.venv\Scripts\python.exe -B -m unittest discover -s tests -v
```

**macOS or Linux**

```bash
backend/.venv/bin/python -B -m unittest discover -s tests -v
```

## Current limitations

- DC solving covers ideal resistors and independent voltage and current sources. Capacitor and RC circuits are outside the current solver scope.
- Question interpretation supports specific wording and component or node IDs. Use the labels shown on the schematic for targeted questions.
- Gemini can misread values, terminals, and connections, especially in unclear images. Ambiguous values need confirmation, and unresolved connectivity blocks solving. The geometry editor can improve readability without changing connectivity.
- Available lesson steps depend on the circuit topology and question. A reduction or transformation can yield a partial result. When a comparison or isolated-source diagram cannot be verified, the lesson provides the equations. Unsupported cases provide diagnostics.

## Planned improvements

- Improve extraction for handwritten and complex diagrams.
- Add a way to correct extracted electrical connectivity.
- Expand supported question patterns.
- Extend the solver and lessons to capacitors and RC circuits.

## Educational purpose

Visual Circuit Tutor helps students connect a circuit drawing to the equations that describe it. Students can follow how each method uses component values and circuit connections, then relate signed current results to directions on the schematic.

Developed by [@shriyasuresh2-max](https://github.com/shriyasuresh2-max).
