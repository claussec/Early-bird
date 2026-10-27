"""Writes the fictitious demo data (backend/app/seed.py) for the in-browser variants.

Output: frontend/src/backend/demo-seed.json (run from the repo root after changing seed.py).
"""

import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "backend"))
from app import seed  # noqa: E402

data = {
    "plants": seed.demo_plants(),
    "suppliers": [{"master": m, "internal": i, "external": e} for m, i, e in seed.demo_suppliers()],
}
out = root / "frontend/src/backend/demo-seed.json"
out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"{out.relative_to(root)}: {len(data['plants'])} plants, {len(data['suppliers'])} suppliers")
