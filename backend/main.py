"""
Visual Circuit Tutor — FastAPI Backend
Analyses uploaded circuit images using Google's Gemini API (google-genai SDK)
and returns structured circuit recognition data. It does NOT solve circuits numerically;
it identifies components and connections visible in the image.
"""

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, List, Optional, Tuple

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import errors, types
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Logging configuration (Never log or print secrets)
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("visual_circuit_tutor")

# ---------------------------------------------------------------------------
# Environment & Gemini client setup
# ---------------------------------------------------------------------------

_env_path = os.path.join(os.path.dirname(__file__), ".env")

# Cached client to avoid re-instantiating on every request
_cached_client: Optional[genai.Client] = None
_cached_api_key: Optional[str] = None


def get_env_config() -> Tuple[Optional[str], str]:
    """
    Reads the latest configuration from backend/.env dynamically.
    Ensures that modifications to .env take effect without requiring a server reboot.
    """
    load_dotenv(dotenv_path=_env_path, override=True)
    api_key = os.getenv("GEMINI_API_KEY")
    # Default to gemini-3.5-flash-lite — recommended by Google for new-user
    # accounts (Gemini 2.5 models are deprecated for new users). Supports
    # multimodal image input, structured output, and system instructions.
    model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite").strip()
    return api_key, model


def get_gemini_client() -> Tuple[genai.Client, str]:
    """
    Retrieves or initializes the Google GenAI client with cached credentials.
    """
    global _cached_client, _cached_api_key
    api_key, model = get_env_config()

    if not api_key:
        raise HTTPException(
            status_code=503,
            detail=(
                "GEMINI_API_KEY is not configured. "
                "Set GEMINI_API_KEY in backend/.env."
            ),
        )

    if _cached_client is None or _cached_api_key != api_key:
        # Use a 60-second timeout to prevent indefinite hangs
        http_options = types.HttpOptions(timeout=60000)
        _cached_client = genai.Client(api_key=api_key, http_options=http_options)
        _cached_api_key = api_key

    return _cached_client, model


# ---------------------------------------------------------------------------
# Pydantic schemas — structured output returned to the frontend
# ---------------------------------------------------------------------------

class CircuitType(str, Enum):
    series = "series"
    parallel = "parallel"
    mixed = "mixed"
    unknown = "unknown"
    not_a_circuit = "not_a_circuit"


class ComponentType(str, Enum):
    resistor = "resistor"
    battery = "battery"
    voltage_source = "voltage_source"
    ac_voltage_source = "ac_voltage_source"
    current_source = "current_source"
    wire = "wire"
    switch = "switch"
    capacitor = "capacitor"
    inductor = "inductor"
    diode = "diode"
    led = "led"
    ground = "ground"
    ammeter = "ammeter"
    voltmeter = "voltmeter"
    unknown = "unknown"


class DetectionStatus(str, Enum):
    confirmed = "confirmed"
    probable = "probable"
    uncertain = "uncertain"


class Point(BaseModel):
    """Normalised coordinate within the image. (0,0) = top-left, (1,1) = bottom-right."""
    x: float = Field(ge=0.0, le=1.0, description="Normalised x (0=left, 1=right)")
    y: float = Field(ge=0.0, le=1.0, description="Normalised y (0=top, 1=bottom)")


class BoundingBox(BaseModel):
    """Axis-aligned bounding box in normalised image coordinates."""
    x: float = Field(ge=0.0, le=1.0, description="Top-left x")
    y: float = Field(ge=0.0, le=1.0, description="Top-left y")
    width: float = Field(ge=0.0, le=1.0, description="Width")
    height: float = Field(ge=0.0, le=1.0, description="Height")


class Terminal(BaseModel):
    label: str = Field(description="Terminal identifier, e.g. 'A', 'B', '+', '−'")
    description: Optional[str] = Field(
        default=None,
        description="Short description of where this terminal is in the image",
    )
    position: Optional[Point] = Field(
        default=None,
        description="Normalised (x, y) position of this terminal in the image, if determinable",
    )


class CurrentDirection(BaseModel):
    fromTerminal: Optional[str] = Field(default=None, description="Terminal label at the visible arrow tail")
    toTerminal: Optional[str] = Field(default=None, description="Terminal label at the visible arrow head")


class Component(BaseModel):
    id: str = Field(description="Unique component identifier, e.g. 'R1', 'V1', 'SW1'")
    type: ComponentType
    visible_value: Optional[str] = Field(
        default=None,
        description=(
            "Transcribe the printed number. For a clearly legible resistance "
            "unit use ASCII 'ohm', preserving any prefix and its case "
            "(e.g. '4 ohm', '2.2 kohm', '470 mohm'). Use 'V' for a legible "
            "volt sign (e.g. '12 V'). Use 'A' or 'mA' for a clearly legible "
            "current unit and preserve any printed sign. If only the number is legible, return "
            "the number alone. Null if no number is legible."
        ),
    )
    terminals: List[Terminal] = Field(
        default_factory=list,
        description="The terminals of this component",
    )
    currentDirection: Optional[CurrentDirection] = Field(
        default=None,
        description="For an independent DC current source only, the visible arrow tail and head terminal labels. Null if uncertain.",
    )
    confidence: float = Field(
        ge=0.0,
        le=1.0,
        description="Confidence that this component is correctly identified (0–1)",
    )
    notes: Optional[str] = Field(
        default=None,
        description="Ambiguity, illegibility, or uncertainty about this component",
    )
    center: Optional[Point] = Field(
        default=None,
        description="Normalised centre of the component symbol in the image, if determinable",
    )
    bbox: Optional[BoundingBox] = Field(
        default=None,
        description="Bounding box of the component symbol in normalised image coordinates",
    )
    orientation: Optional[float] = Field(
        default=None,
        ge=-180.0,
        le=180.0,
        description=(
            "Rotation of the component in degrees. 0 = horizontal left-to-right, "
            "90 = vertical top-to-bottom, -90 = vertical bottom-to-top. "
            "Null if orientation cannot be determined."
        ),
    )
    status: Optional[DetectionStatus] = Field(
        default=None,
        description="Detection confidence level: confirmed, probable, or uncertain",
    )


class Connection(BaseModel):
    from_component: str = Field(description="Component ID of the source end")
    from_terminal: str = Field(description="Terminal label on the source component")
    to_component: str = Field(description="Component ID of the destination end")
    to_terminal: str = Field(description="Terminal label on the destination component")
    notes: Optional[str] = Field(
        default=None,
        description="Notes about this connection, e.g. ambiguous crossing",
    )
    confidence: float = Field(
        default=1.0,
        ge=0.0,
        le=1.0,
        description="Confidence that this connection is correct (0–1)",
    )
    status: Optional[DetectionStatus] = Field(
        default=None,
        description="Detection confidence level: confirmed, probable, or uncertain",
    )


class WirePath(BaseModel):
    """A wire segment as a polyline through normalised image coordinates."""
    id: str = Field(description="Unique wire identifier, e.g. 'W1', 'W2'")
    points: List[Point] = Field(
        default_factory=list,
        description="Ordered points on one continuous visible conductor from the named start terminal to the named end terminal, including bends and intervening junctions",
    )
    from_component: str = Field(description="Component ID at the start of this wire")
    from_terminal: str = Field(description="Terminal label at the start")
    to_component: str = Field(description="Component ID at the end of this wire")
    to_terminal: str = Field(description="Terminal label at the end")
    is_junction: bool = Field(
        default=False,
        description="True if the traced path passes through a verified electrical branch junction",
    )
    is_crossing: bool = Field(
        default=False,
        description="True if this wire crosses another wire WITHOUT electrical connection",
    )
    confidence: float = Field(
        default=1.0,
        ge=0.0,
        le=1.0,
        description="Confidence that this wire path is correctly traced (0–1)",
    )


class Junction(BaseModel):
    """A physical branch where visible conductors electrically connect."""
    id: str = Field(description="Unique junction identifier, e.g. 'J1'")
    position: Optional[Point] = Field(
        default=None,
        description="Normalised position of the physical branch in the image",
    )
    members: List[str] = Field(
        default_factory=list,
        description="Component terminal keys reached by branches of this junction, using the exact reported component IDs and labels, e.g. ['R1.B', 'R2.A']",
    )
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    status: Optional[DetectionStatus] = Field(
        default=None,
        description="Use uncertain when the branch or its terminal membership cannot be verified",
    )


class NodeGroup(BaseModel):
    """An explicitly identified electrical node grouping terminals together."""
    id: str = Field(description="Node identifier, e.g. 'N0', 'N1'")
    members: List[str] = Field(
        default_factory=list,
        description="Terminal keys on one verified continuous conductor network, each assigned to at most one node group",
    )


class CircuitAnalysis(BaseModel):
    contains_circuit: bool = Field(
        default=True,
        description="True if the image contains an electrical circuit diagram",
    )
    is_circuit: Optional[bool] = Field(
        default=None,
        description="Alias for contains_circuit indicating whether the image is a circuit",
    )
    circuit_type: CircuitType
    components: List[Component] = Field(default_factory=list)
    connections: List[Connection] = Field(default_factory=list)
    wires: List[WirePath] = Field(
        default_factory=list,
        description="Wire segments traced through the image with their geometric paths",
    )
    junctions: List[Junction] = Field(
        default_factory=list,
        description="Physical branching points where visible conductors electrically join",
    )
    nodes: List[NodeGroup] = Field(
        default_factory=list,
        description="Explicit electrical node groupings if the model can identify them",
    )
    image_width: Optional[int] = Field(
        default=None,
        description="Width of the uploaded image in pixels, if known",
    )
    image_height: Optional[int] = Field(
        default=None,
        description="Height of the uploaded image in pixels, if known",
    )
    question_text: Optional[str] = Field(
        default=None,
        description="Textbook question or problem statement visible in the image, if any",
    )
    unclear_details: List[str] = Field(
        default_factory=list,
        description="Specific details that are ambiguous or illegible",
    )
    general_notes: Optional[str] = Field(
        default=None,
        description="Overall notes about recognition quality or image limitations",
    )
    reconstruction_incomplete: bool = Field(
        default=False,
        description="True if the reconstruction is incomplete due to missing or uncertain information",
    )


# ---------------------------------------------------------------------------
# Prompts for the vision model
# ---------------------------------------------------------------------------

_SYSTEM_CONTENT = """\
You are an expert electrical-engineering circuit analyser.

Your task is to examine the provided image and identify every visible electrical
circuit component, their connections, and their geometric positions with maximum
fidelity. The output will be used to RECONSTRUCT the same circuit visually, so
geometric accuracy is as important as electrical accuracy.

COORDINATE SYSTEM:
- All coordinates are NORMALISED to the range [0.0, 1.0].
- (0, 0) is the TOP-LEFT corner of the image, (1, 1) is the BOTTOM-RIGHT.
- Estimate positions as accurately as you can from the image.

Component recognition rules:
- Resistors: rectangular box symbol or zigzag/sawtooth symbol
- Batteries / ideal DC voltage sources: circle with +/− polarity marks, or
  multi-cell symbol with stacked horizontal lines → type "battery" or "voltage_source"
- AC voltage sources: circle with a sine-wave symbol → type "ac_voltage_source"
- Independent DC current sources: circle with an internal arrow → type "current_source".
  Exclude AC and dependent sources. Use two distinct terminal labels "A" and "B".
  Set currentDirection.fromTerminal to the terminal at the arrow tail and
  currentDirection.toTerminal to the terminal at the arrow head. Read the
  arrowhead on the symbol itself; do not infer it from position, terminal
  order, wire geometry, or a printed current sign. Preserve the printed
  signed value with "A" or "mA". If the arrow is unclear, leave
  currentDirection null and describe the uncertainty in the component notes.
- Current sources: circle with an arrow indicating current direction
- Wires: lines connecting components → type "wire"
- Switches: a gap or lever symbol in a conductor path
- Capacitors: two parallel lines (sometimes with a curve on one)
- Inductors: a series of loops or humps
- Ground symbols: horizontal lines diminishing in size, or a downward triangle
- Diodes: a triangle pointing to a line (filled or outlined)
- LEDs: a diode symbol with two small arrows (emission lines)
- Ammeters: circle with "A" → type "ammeter"
- Voltmeters: circle with "V" → type "voltmeter"
- Any symbol you cannot confidently classify → type "unknown"

FOR EACH COMPONENT you must report:
- A unique ID (R1, R2, V1, I1, SW1, C1, L1, G1, U1 …)
- Its type from the allowed list
- The exact value label shown in the image (e.g. "4 Ω", "12 V") — leave null
  if no value is legibly printed near the component
- Its terminals. For polarity sources use terminal labels "+" and "−". For
  two-terminal passives use "A" and "B". Keep terminal labels consistent.
- A confidence score (0–1) — use < 0.7 for anything uncertain
- centre: the normalised (x, y) position of the component's centre in the image
- orientation: rotation in degrees (0 = horizontal left-to-right, 90 = vertical
  top-to-bottom, -90 = vertical bottom-to-top). Null if you cannot tell.
- status: "confirmed" for clear identifications, "probable" for likely but
  uncertain ones, "uncertain" for unclear ones.

FOR EACH PHYSICAL TERMINAL, report its position where the conductor meets the
symbol, when visible. Assign each label to a physical end once and reuse that
exact terminal key everywhere. Keep the opposite ends of a symbol distinct.

WIRES:
- Follow the visible conductor from each terminal through bends and verified
  branches. Stop at gaps, other component bodies, or ambiguous intersections.
- Report traceable terminal-to-terminal paths as WirePath records with:
  - An ordered list of points tracing the wire's path through the image
    (include bends and turns — do NOT simplify a bent wire to a straight line)
  - The component and terminal at each end
  - is_junction: true if the path passes through a verified electrical branch
  - is_crossing: true if the path crosses another wire without joining it
  - confidence (0–1)

JUNCTIONS:
- Report the visible position of each electrical branch. A clear T-join or a
  dot joining branches is evidence of contact. Crossing lines that continue
  independently are separate. If contact is ambiguous, mark the junction
  uncertain or omit it and describe the ambiguity.
- List only component terminal keys that can be followed from this branch.
  Do not use wire endpoint IDs or use printed node letters as terminal keys.

CONNECTIONS:
- Derive pairwise connections and node groups from the same set of verified
  traces and branch contacts. Multiple paths through a network may lead to the
  same node. Never connect through a component body.
- Give each connection a confidence score and status (confirmed/probable/uncertain).
- If the path is uncertain, record it as uncertain and leave it out of verified
  node membership. Describe which terminals or conductor span are ambiguous.

NODES:
- Group terminals by continuous verified conductors. Branches and bends do not
  split a node. Assign each terminal to at most one node group.
- Before returning, check that every confirmed connection, verified trace, and
  confirmed junction agrees with the node groups and uses defined terminals.
  If they disagree, retrace the image. When the conflict remains unresolved,
  omit disputed memberships, mark disputed claims uncertain, set
  reconstruction_incomplete, and describe the conflict in unclear_details.
- Infer circuit_type only after tracing. Never use circuit type, component
  names, expected loop counts, or typical arrangements to fill missing links.

CRITICAL — what you must NOT do:
- Do NOT invent component values that are not printed clearly in the image.
- Transcribe a legible ohm unit as ASCII "ohm", never as a symbol. Keep
  printed prefixes and their case: use "kohm" for kiloohms, "mohm" for
  milliohms and "Mohm" for megaohms. Check every resistor value before
  submitting: use "ohm" only when the printed unit is clear. If only the
  number is legible, report it without a unit and note the uncertainty in
  unclear_details. Do not infer units from component type.
- Do NOT guess connections that are not clearly drawn.
- Do NOT add a connection merely to close a circuit or complete a loop.
- Do NOT connect wires just because they visually cross without a junction dot.
- Do NOT invent missing junction dots.
- Do NOT change component polarity without evidence.
- Do NOT generate a generic circuit when the image is unclear.
- Do NOT state that you have calculated or solved anything numerically.
- If the reconstruction is incomplete or uncertain, set reconstruction_incomplete
  to true and explain what is missing in general_notes.
- Always set contains_circuit and is_circuit to True if an electrical circuit
  is present, False otherwise.

ACCURACY PRINCIPLE: A partially reconstructed but truthful diagram is
preferable to an invented, electrically incorrect diagram.
"""

_USER_CONTENT = (
    "Analyse this electrical circuit image. "
    "Return a structured JSON object describing every component (with its "
    "centre position, orientation, and terminals), every wire path (with "
    "bends), every junction, and every connection. "
    "Pay close attention to junction dots versus crossings, source polarity, "
    "exact value labels, and component orientations. "
    "Report normalised coordinates where possible. Be precise and honest about "
    "anything unclear — mark uncertain detections rather than guessing."
)


def validate_current_directions(result: CircuitAnalysis) -> None:
    """Withhold unresolved arrows without changing electrical connectivity."""
    for component in result.components:
        if component.type != ComponentType.current_source:
            continue
        direction = component.currentDirection
        labels = {terminal.label.strip() for terminal in component.terminals}
        tail = (direction.fromTerminal or "").strip() if direction else ""
        head = (direction.toTerminal or "").strip() if direction else ""
        if len(component.terminals) == 2 and tail and head and tail != head and {tail, head} == labels:
            component.currentDirection = CurrentDirection(fromTerminal=tail, toTerminal=head)
        else:
            component.currentDirection = None
            note = "Current source arrow direction needs confirmation."
            component.notes = " ".join(filter(None, (component.notes, note)))


def flag_connectivity_issues(result: CircuitAnalysis) -> None:
    """Keep conflicting evidence for reconciliation and flag it for the caller."""
    if not result.contains_circuit:
        return

    def terminal_key(key: str) -> str:
        component, separator, label = key.strip().rpartition(".")
        return f"{component}{separator}{label.strip().replace('−', '-')}"

    terminals = {
        terminal_key(f"{component.id}.{terminal.label}")
        for component in result.components
        for terminal in component.terminals
    }
    memberships: dict[str, set[str]] = {}
    issues: list[str] = []
    review_notes: list[str] = []
    group_sizes: dict[str, int] = {}
    for node in result.nodes:
        group_sizes[node.id] = group_sizes.get(node.id, 0) + len(node.members)
        for member in node.members:
            key = terminal_key(member)
            if key in terminals:
                memberships.setdefault(key, set()).add(node.id)
            else:
                issues.append(f"Node {node.id} references unknown terminal {member}.")
    review_memberships = memberships.copy()
    for key, groups in memberships.items():
        if len(groups) > 1:
            message = f"Terminal {key} belongs to multiple reported nodes: {', '.join(sorted(groups))}."
            populated = {group for group in groups if group_sizes[group] > 1}
            if len(populated) == 1:
                # Defer a redundant singleton candidate to the graph's trace
                # checks. Keep the original memberships in the response.
                review_memberships[key] = populated
                review_notes.append(message)
            else:
                issues.append(message)

    def check_claim(name: str, keys: list[str], verified: bool, direct: bool = False) -> None:
        unknown = set(keys) - terminals
        if unknown:
            issues.append(f"{name} references unknown terminals: {', '.join(sorted(unknown))}.")
        if not verified:
            return
        groups = {group for key in keys for group in review_memberships.get(key, set())}
        if len(groups) > 1:
            message = f"{name} spans different reported nodes: {', '.join(sorted(groups))}."
            # The frontend reconciler has the trace checks needed to decide
            # whether two isolated endpoint declarations are actually one net.
            if direct and len(groups) == 2 and all(len(memberships.get(key, ())) == 1 for key in keys) \
                    and all(group_sizes[group] == 1 for group in groups):
                review_notes.append(message)
            else:
                issues.append(message)

    for connection in result.connections:
        start = terminal_key(f"{connection.from_component}.{connection.from_terminal}")
        end = terminal_key(f"{connection.to_component}.{connection.to_terminal}")
        check_claim(
            f"Connection {start} to {end}", [start, end],
            connection.status != DetectionStatus.uncertain and connection.confidence >= 0.7,
            direct=True,
        )
    for junction in result.junctions:
        check_claim(
            f"Junction {junction.id}", [terminal_key(member) for member in junction.members],
            junction.status != DetectionStatus.uncertain
            and (junction.confidence is None or junction.confidence >= 0.7),
        )
    for wire in result.wires:
        start = terminal_key(f"{wire.from_component}.{wire.from_terminal}")
        end = terminal_key(f"{wire.to_component}.{wire.to_terminal}")
        check_claim(f"Wire {wire.id}", [start, end], False)
        if len({(point.x, point.y) for point in wire.points}) < 2:
            issues.append(f"Wire {wire.id} has no usable conductor span.")

    if issues:
        result.reconstruction_incomplete = True
    if issues or review_notes:
        result.unclear_details = list(dict.fromkeys([*result.unclear_details, *issues, *review_notes]))


# ---------------------------------------------------------------------------
# Opt-in debug capture of the analysis output
# ---------------------------------------------------------------------------

def save_debug_analysis(
    result: CircuitAnalysis,
    response: Any,
    model: str,
) -> None:
    """
    Write the validated analysis (and Gemini's raw JSON) to a timestamped file
    when GEMINI_DEBUG_DIR is set. Does nothing otherwise.

    This is strictly diagnostic. The directory is created on demand, and any
    failure — bad permissions, full disk, unserialisable payload — is logged
    and swallowed, so a successful analysis is never turned into an error
    response. Only the analysis payload is written: never the uploaded image
    bytes, the API key, or any other credential.
    """
    try:
        debug_dir = (os.getenv("GEMINI_DEBUG_DIR") or "").strip()
        if not debug_dir:
            return

        captured_at = datetime.now(timezone.utc)
        # `.text` is a property that raises when the response carries no
        # candidate text, so treat that as "raw text unavailable" rather than
        # losing the parsed payload with it.
        try:
            raw_text = response.text
        except Exception:
            raw_text = None

        payload = {
            "captured_at": captured_at.isoformat(),
            "model": model,
            # What the application will actually use.
            "parsed": result.model_dump(mode="json"),
            # What the model actually returned, verbatim (None if unavailable).
            "raw_response_text": raw_text or None,
        }

        os.makedirs(debug_dir, exist_ok=True)
        filename = (
            f"analysis_{captured_at.strftime('%Y%m%dT%H%M%S_%fZ')}"
            f"_{uuid.uuid4().hex[:8]}.json"
        )
        path = os.path.join(debug_dir, filename)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
            handle.write("\n")

        logger.info(f"Saved debug analysis capture to {path}")
    except Exception:
        # A diagnostic aid must never break the request it is observing.
        logger.warning("Could not save debug analysis capture", exc_info=True)


# ---------------------------------------------------------------------------
# FastAPI application & CORS
# ---------------------------------------------------------------------------

app = FastAPI(title="Visual Circuit Tutor API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:5175",
        "http://127.0.0.1:5175",
        "http://localhost:5176",
        "http://127.0.0.1:5176",
        "http://localhost:5177",
        "http://127.0.0.1:5177",
    ],
    # Regex permits any local dev server port (e.g., localhost:5173..5180)
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)

_ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
_MAX_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB


@app.get("/api/health")
def health_check():
    api_key, model = get_env_config()
    return {
        "status": "ok",
        "message": "Backend is running",
        "gemini_configured": bool(api_key),
        "model": model,
    }


@app.post("/api/analyze-image", response_model=CircuitAnalysis)
async def analyze_image(file: UploadFile = File(...)):
    """
    Accept a PNG, JPEG, or WebP image, send it to Google Gemini vision API,
    and return structured circuit recognition data.

    This endpoint identifies components and connections only.
    It does NOT numerically solve the circuit.
    """
    # --- Validate MIME type -------------------------------------------------
    if file.content_type not in _ALLOWED_TYPES:
        raise HTTPException(
            status_code=415,
            detail=(
                f"Unsupported file type '{file.content_type}'. "
                "Please upload a JPEG, PNG, or WebP image. "
                "SVG files cannot be processed by the vision model — "
                "export your diagram as a PNG first."
            ),
        )

    # --- Read and size-check ------------------------------------------------
    image_data = await file.read(_MAX_SIZE_BYTES + 1)

    if len(image_data) > _MAX_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Image exceeds the 5 MB limit. Please reduce the file size.",
        )

    if not image_data:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")

    # --- Obtain client and configured model ---------------------------------
    client, model = get_gemini_client()
    image_part = types.Part.from_bytes(
        data=image_data,
        mime_type=file.content_type,
    )

    logger.info(f"Submitting image analysis to Gemini using model: {model}")

    try:
        response = client.models.generate_content(
            model=model,
            contents=[image_part, _USER_CONTENT],
            config=types.GenerateContentConfig(
                system_instruction=_SYSTEM_CONTENT,
                response_mime_type="application/json",
                response_schema=CircuitAnalysis,
            ),
        )
    except errors.ClientError as e:
        status_code = getattr(e, "code", 400) or 400
        message = getattr(e, "message", str(e))
        logger.error(f"Gemini ClientError ({status_code}): {message}")

        if status_code in (401, 403):
            raise HTTPException(
                status_code=401,
                detail=(
                    f"Gemini API authentication failed: {message}. "
                    "Check that GEMINI_API_KEY in backend/.env is valid and authorized."
                ),
            )
        elif status_code == 429:
            raise HTTPException(
                status_code=429,
                detail=(
                    f"Gemini API quota or rate limit exceeded: {message}. "
                    "Please wait a moment and try again."
                ),
            )
        elif status_code == 404:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"Gemini model '{model}' was not found: {message}. "
                    "Please configure a valid GEMINI_MODEL in backend/.env."
                ),
            )
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Gemini API request failed ({status_code}): {message}",
            )
    except errors.ServerError as e:
        message = getattr(e, "message", str(e))
        logger.error(f"Gemini ServerError: {message}")
        raise HTTPException(
            status_code=503,
            detail=f"Gemini API service is temporarily unavailable: {message}",
        )
    except errors.APIError as e:
        status_code = getattr(e, "code", 502) or 502
        message = getattr(e, "message", str(e))
        logger.error(f"Gemini APIError ({status_code}): {message}")
        raise HTTPException(
            status_code=status_code if 400 <= status_code < 600 else 502,
            detail=f"Gemini API error ({status_code}): {message}",
        )
    except Exception as e:
        logger.error(f"Unexpected connection exception: {e}")
        raise HTTPException(
            status_code=502,
            detail=f"Could not connect to the Gemini API: {str(e)}",
        )

    # --- Parse and normalize output -----------------------------------------
    result: Optional[CircuitAnalysis] = None
    if hasattr(response, "parsed") and response.parsed is not None:
        if isinstance(response.parsed, CircuitAnalysis):
            result = response.parsed
        elif isinstance(response.parsed, dict):
            result = CircuitAnalysis.model_validate(response.parsed)

    if result is None:
        # Fallback to response.text JSON parsing
        raw_text = getattr(response, "text", "")
        if raw_text:
            try:
                result = CircuitAnalysis.model_validate_json(raw_text)
            except Exception as parse_err:
                logger.error(f"Failed to validate JSON: {parse_err}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to parse structured response from Gemini: {parse_err}",
                )
        else:
            raise HTTPException(
                status_code=500,
                detail="Gemini returned an empty response.",
            )

    # Ensure is_circuit and contains_circuit stay synchronized
    if result.is_circuit is None:
        result.is_circuit = result.contains_circuit
    if result.contains_circuit is None:
        result.contains_circuit = result.is_circuit

    validate_current_directions(result)
    flag_connectivity_issues(result)

    # Optional diagnostic capture; a no-op unless GEMINI_DEBUG_DIR is set.
    # Reads the validated model only and never mutates it.
    save_debug_analysis(result, response, model)

    return result
