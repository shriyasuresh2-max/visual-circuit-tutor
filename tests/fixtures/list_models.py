"""
Lists all Gemini models available to this API key using the installed
google-genai SDK. Loads .env the same way the backend does. Does NOT
print the API key. Prints model names and supported generation methods.
"""
import os
from dotenv import load_dotenv
from google import genai

env_path = os.path.join(os.path.dirname(__file__), "..", "..", "backend", ".env")
load_dotenv(dotenv_path=env_path, override=True)
api_key = os.getenv("GEMINI_API_KEY")
client = genai.Client(api_key=api_key)

for m in client.models.list():
    name = m.name
    methods = getattr(m, "supported_generation_methods", None)
    print(f"{name}  |  {methods}")
