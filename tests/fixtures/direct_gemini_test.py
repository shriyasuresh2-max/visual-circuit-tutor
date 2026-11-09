"""
Directly tests the Gemini API with the test circuit image and the same
structured-output config the backend uses. Does NOT modify .env or any files.
Loads the API key from .env the same way the backend does (never printed).

Tries the API-recommended model first, then falls back to alternatives
from the SDK model list. Reports the exact model that works and the
parsed circuit analysis.
"""
import os
import sys
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from dotenv import load_dotenv
from google import genai
from google.genai import types

env_path = os.path.join(os.path.dirname(__file__), "..", "..", "backend", ".env")
load_dotenv(dotenv_path=env_path, override=True)
api_key = os.getenv("GEMINI_API_KEY")

img_path = os.path.join(os.path.dirname(__file__), "sample_series_circuit.png")
with open(img_path, "rb") as f:
    image_data = f.read()

client = genai.Client(api_key=api_key)

# Import the backend's prompt and schema (same code path)
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))
from main import _SYSTEM_CONTENT, _USER_CONTENT, CircuitAnalysis

# Models to try, in order of preference (API-recommended first)
CANDIDATES = [
    "gemini-3.5-flash-lite",   # API's own recommendation
    "gemini-3.5-flash",        # same family, non-lite
    "gemini-3.8-flash",        # newest flash
]

image_part = types.Part.from_bytes(data=image_data, mime_type="image/png")

for model in CANDIDATES:
    print(f"\n--- Testing model: {model} ---")
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
        parsed = getattr(response, "parsed", None)
        if parsed is not None:
            if isinstance(parsed, dict):
                parsed = CircuitAnalysis.model_validate(parsed)
            print(f"SUCCESS with model: {model}")
            print(f"  contains_circuit: {parsed.contains_circuit}")
            print(f"  circuit_type: {parsed.circuit_type}")
            print(f"  components: {len(parsed.components)}")
            for c in parsed.components:
                print(f"    {c.id} ({c.type}) = {c.visible_value}  conf={c.confidence}")
            print(f"  connections: {len(parsed.connections)}")
            for conn in parsed.connections:
                print(f"    {conn.from_component}.{conn.from_terminal} -> {conn.to_component}.{conn.to_terminal}")
            print(f"  wires: {len(parsed.wires)}")
            for w in parsed.wires:
                print(f"    {w.id}: {w.from_component}.{w.from_terminal} -> {w.to_component}.{w.to_terminal} points={len(w.points)}")
            print(f"  junctions: {len(parsed.junctions)}")
            # Save raw JSON for offline fixture testing
            fixture_out = os.path.join(os.path.dirname(__file__), "sample_extracted_analysis.json")
            with open(fixture_out, "w", encoding="utf-8") as f:
                f.write(parsed.model_dump_json(indent=2))
            print(f"  Saved output to {fixture_out}")
            print(f"\nWORKING MODEL: {model}")
            break
        else:
            raw = getattr(response, "text", "")
            print(f"  No parsed output. Raw text (first 200 chars): {raw[:200]}")
    except Exception as e:
        msg = getattr(e, "message", str(e))
        print(f"  FAILED: {msg[:300]}")
