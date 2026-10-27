"""Geocoding of supplier and plant addresses for the 3D map.

Default: offline lookup of the city in a bundled gazetteer (data/gazetteer.json, built from
GeoNames, CC BY 4.0), falling back to the country's largest city. Optional: Nominatim
(OpenStreetMap) for street-level precision with GEOCODER=nominatim; please respect its
usage policy (max. 1 request per second, identifying User-Agent).
"""

import json
import unicodedata
from functools import lru_cache
from pathlib import Path

import httpx

from .config import settings

GAZETTEER = Path(__file__).resolve().parents[2] / "data" / "gazetteer.json"


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().casefold()
    return " ".join(s.replace("-", " ").split())


@lru_cache(maxsize=1)
def _index() -> tuple[dict, dict]:
    rows = json.loads(GAZETTEER.read_text(encoding="utf-8")) if GAZETTEER.exists() else []
    by_city: dict[tuple[str, str], tuple[float, float]] = {}
    by_country: dict[str, tuple[float, float]] = {}
    for name, country, lat, lon in rows:  # sorted by population, largest first
        by_city.setdefault((_norm(name), country), (lat, lon))
        by_country.setdefault(country, (lat, lon))
    return by_city, by_country


def _offline(city: str, country: str) -> dict | None:
    by_city, by_country = _index()
    country = (country or "").strip().upper()
    if city:
        hit = by_city.get((_norm(city), country))
        if hit is None and not country:
            hit = next((v for (c, _), v in by_city.items() if c == _norm(city)), None)
        if hit is None:  # "Ludwigshafen" → "Ludwigshafen am Rhein"
            prefix = _norm(city) + " "
            hit = next((v for (c, cc), v in by_city.items() if cc == country and c.startswith(prefix)), None)
        if hit:
            return {"lat": hit[0], "lon": hit[1], "precision": "city", "source": "gazetteer"}
    if country in by_country:
        lat, lon = by_country[country]
        return {"lat": lat, "lon": lon, "precision": "country", "source": "gazetteer"}
    return None


def _nominatim(street: str, zip_code: str, city: str, country: str) -> dict | None:
    try:
        r = httpx.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "street": street, "postalcode": zip_code, "city": city, "countrycodes": country.lower(),
                "format": "json", "limit": 1,
            },
            headers={"User-Agent": "SupplierRiskRadar/1.0 (supplier early-warning prototype)"},
            timeout=10,
        )
        r.raise_for_status()
        hits = r.json()
    except (httpx.HTTPError, ValueError):
        return None
    if not hits:
        return None
    return {"lat": float(hits[0]["lat"]), "lon": float(hits[0]["lon"]), "precision": "address", "source": "nominatim"}


def geocode(street: str = "", zip_code: str = "", city: str = "", country: str = "") -> dict | None:
    """Coordinates for an address, or None if neither city nor country is known."""
    if settings.geocoder == "nominatim" and (street or city):
        hit = _nominatim(street, zip_code, city, country)
        if hit:
            return hit
    return _offline(city, country)


def locate(entity: dict, lat: float | None = None, lon: float | None = None) -> dict | None:
    """Manual coordinates win; otherwise the address is geocoded."""
    if lat is not None and lon is not None:
        return {"lat": lat, "lon": lon, "precision": "manual", "source": "manual"}
    return geocode(entity.get("street", ""), entity.get("zip", ""), entity.get("city", ""), entity.get("country", ""))
