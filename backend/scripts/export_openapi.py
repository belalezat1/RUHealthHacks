"""Export the source contract for openapi-typescript; no database or secret required."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.main import app

path = Path(__file__).resolve().parents[2] / 'frontend' / 'openapi.json'
path.write_text(json.dumps(app.openapi(), indent=2) + '\n')
print(path)
