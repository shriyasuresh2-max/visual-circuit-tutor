"""
Uploads the test circuit PNG to the backend /api/analyze-image endpoint
and prints the structured analysis response. Uses only the Python
standard library (urllib) for correct multipart encoding.
"""
import json
import os
import urllib.request
import uuid

img_path = os.path.join(os.path.dirname(__file__), "sample_series_circuit.png")
url = "http://127.0.0.1:8000/api/analyze-image"

with open(img_path, "rb") as f:
    file_data = f.read()

boundary = uuid.uuid4().hex
body = (
    f"--{boundary}\r\n"
    f'Content-Disposition: form-data; name="file"; filename="sample_series_circuit.png"\r\n'
    f"Content-Type: image/png\r\n\r\n"
).encode("utf-8") + file_data + f"\r\n--{boundary}--\r\n".encode("utf-8")

req = urllib.request.Request(
    url,
    data=body,
    headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    method="POST",
)

try:
    with urllib.request.urlopen(req, timeout=90) as resp:
        result = json.loads(resp.read().decode("utf-8"))
        print("HTTP", resp.status)
        print(json.dumps(result, indent=2, ensure_ascii=False))
except urllib.error.HTTPError as e:
    err_body = e.read().decode("utf-8", errors="replace")
    print(f"HTTP {e.code}")
    print(err_body)
except Exception as e:
    print(f"Error: {e}")
