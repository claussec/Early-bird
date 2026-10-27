"""Synthetic demo data (SEED_DEMO_DATA=true). All companies are fictitious."""

import random

from . import db, geo

COMMODITIES = [
    "Metall & Umformung",
    "Elektronik",
    "Kunststoff & Gummi",
    "Antrieb & Mechanik",
    "Oberfläche & Chemie",
]

BUYERS = [
    {"name": "Julia Hartmann", "email": "j.hartmann@example.com"},
    {"name": "Tobias Brenner", "email": "t.brenner@example.com"},
    {"name": "Selin Aydin", "email": "s.aydin@example.com"},
    {"name": "Marco Ferri", "email": "m.ferri@example.com"},
]

# Plants of the (fictitious) buying organization; their contacts are warned about linked suppliers.
PLANTS = [
    {
        "id": "P01", "name": "Werk Pforzheim (Demo)", "street": "Musterstraße 1", "zip": "75172",
        "city": "Pforzheim", "country": "DE",
        "contacts": [
            {"name": "Anna Keller", "email": "a.keller@example.com", "role": "Werkleitung"},
            {"name": "Lukas Wenzel", "email": "l.wenzel@example.com", "role": "Disposition"},
        ],
    },
    {
        "id": "P02", "name": "Werk Leipzig (Demo)", "street": "Beispielweg 7", "zip": "04103",
        "city": "Leipzig", "country": "DE",
        "contacts": [
            {"name": "Miriam Schulz", "email": "m.schulz@example.com", "role": "Werkleitung"},
            {"name": "Julia Hartmann", "email": "j.hartmann@example.com", "role": "Einkauf"},
        ],
    },
    {
        "id": "P03", "name": "Werk Kecskemét (Demo)", "street": "Példa utca 3", "zip": "6000",
        "city": "Kecskemét", "country": "HU",
        "contacts": [
            {"name": "Bence Varga", "email": "b.varga@example.com", "role": "Plant manager"},
        ],
    },
]

# name, street, zip, city, country, commodity, profile, linked plants.
# All companies and addresses are invented; "(Demo)" makes this visible everywhere.
SUPPLIERS = [
    ("Kessler Umformtechnik GmbH", "Industriestraße 12", "75179", "Pforzheim", "DE", 0, "healthy", ["P01"]),
    ("Brandt Präzisionsguss GmbH", "Am Gießereiweg 4", "73431", "Aalen", "DE", 0, "dependency", ["P01", "P02"]),
    ("Vogtland Stanztechnik GmbH", "Gewerbering 8", "08523", "Plauen", "DE", 0, "critical", ["P02", "P03"]),
    ("Moravia Forge s.r.o.", "Průmyslová 21", "61200", "Brno", "CZ", 0, "recovering", ["P03"]),
    ("NordElektra Components AG", "Hafenkai 3", "24103", "Kiel", "DE", 1, "healthy", ["P02"]),
    ("Silesia Cable Systems Sp. z o.o.", "ul. Przemysłowa 5", "40-020", "Katowice", "PL", 1, "declining", ["P02", "P03"]),
    ("Alpen Sensorik GmbH", "Technologiepark 2", "8020", "Graz", "AT", 1, "hidden", ["P01"]),
    ("Lombarda Elettronica S.p.A.", "Via dell'Industria 9", "24126", "Bergamo", "IT", 1, "quality", ["P01"]),
    ("Rheinpolymer GmbH", "Chemiestraße 15", "67059", "Ludwigshafen", "DE", 2, "declining", ["P01", "P02"]),
    ("Danubia Plastics Kft.", "Ipari út 14", "9027", "Győr", "HU", 2, "healthy", ["P03"]),
    ("Iberflex Sellados S.L.", "Calle Industria 22", "50014", "Zaragoza", "ES", 2, "dependency", ["P01"]),
    ("Hohenlohe Antriebstechnik GmbH", "Getriebeweg 6", "74653", "Künzelsau", "DE", 3, "healthy", ["P01"]),
    ("Carpathia Gears S.R.L.", "Strada Fabricii 10", "550018", "Sibiu", "RO", 3, "critical", ["P03"]),
    ("Saxonia Lager & Wellen GmbH", "Lagerstraße 11", "09111", "Chemnitz", "DE", 3, "recovering", ["P02"]),
    ("Neckar Galvanik GmbH", "Uferstraße 30", "74072", "Heilbronn", "DE", 4, "hidden", ["P01"]),
    ("Bohemia Coatings a.s.", "Tovární 7", "30100", "Pilsen", "CZ", 4, "quality", ["P02", "P03"]),
]
DEMO_SUFFIX = " (Demo)"

PROFILES = {
    # rev_growth, share_start, share_end, pd_path, plan_next_change, plan_noise, ppm_path, otd
    "healthy": dict(g=0.05, s0=0.12, s1=0.14, pd=[0.4, 0.4, 0.3, 0.3], plan=0.04, noise=0.02, ppm=[40, 38, 35], otd=0.985),
    "dependency": dict(g=0.0, s0=0.38, s1=0.56, pd=[0.6, 0.7, 0.8, 0.9], plan=-0.04, noise=0.05, ppm=[60, 58, 62], otd=0.97),
    "declining": dict(g=-0.04, s0=0.25, s1=0.32, pd=[0.8, 1.2, 1.9, 2.6], plan=-0.12, noise=0.12, ppm=[55, 70, 85], otd=0.94),
    "critical": dict(g=-0.08, s0=0.35, s1=0.48, pd=[1.2, 2.0, 3.4, 4.6], plan=-0.18, noise=0.18, ppm=[90, 130, 190], otd=0.89),
    "recovering": dict(g=0.03, s0=0.28, s1=0.24, pd=[2.8, 2.4, 1.6, 1.1], plan=0.05, noise=0.04, ppm=[120, 90, 70], otd=0.965),
    "hidden": dict(g=0.01, s0=0.22, s1=0.27, pd=[0.5, 0.5, 0.6, 0.6], plan=-0.11, noise=0.10, ppm=[45, 48, 52], otd=0.975),
    "quality": dict(g=0.03, s0=0.18, s1=0.20, pd=[0.5, 0.5, 0.5, 0.6], plan=0.0, noise=0.03, ppm=[70, 110, 210], otd=0.91),
}

NEWS = {
    "healthy": [
        ("2025-05-14", "{n} investiert 12 Mio. € in neue Fertigungslinie", "Presse"),
        ("2025-02-03", "{n} gewinnt Nachhaltigkeitspreis der IHK", "ESG"),
    ],
    "dependency": [
        ("2025-03-21", "{n}: Großkunde aus dem Non-Automotive-Bereich verlagert Aufträge nach Asien", "Markt"),
        ("2024-11-08", "{n} beantragt Fördermittel für Standortsicherung", "Finanzen"),
    ],
    "declining": [
        ("2025-06-30", "{n} kündigt Kurzarbeit für 140 Beschäftigte an", "Personal"),
        ("2025-01-17", "Geschäftsführer von {n} verlässt das Unternehmen überraschend", "Management"),
        ("2024-09-12", "{n}: Bilanz 2023 mit deutlichem Verlust veröffentlicht", "Finanzen"),
    ],
    "critical": [
        ("2025-08-02", "Gerüchte um Restrukturierung bei {n} – Gespräche mit Banken", "Finanzen"),
        ("2025-06-11", "{n} streicht 200 Stellen und schließt Werk 2", "Personal"),
        ("2025-03-04", "Lieferanten von {n} berichten von verzögerten Zahlungen", "Finanzen"),
        ("2024-12-19", "Kununu: Bewertungen von {n} brechen ein – 'Stimmung schlecht'", "Personal"),
    ],
    "recovering": [
        ("2025-07-22", "{n} meldet Rückkehr in die Gewinnzone", "Finanzen"),
        ("2025-03-10", "Neuer Finanzinvestor steigt bei {n} ein", "Finanzen"),
    ],
    "hidden": [
        ("2025-07-08", "{n} prüft Verlagerung der Produktion – Betriebsrat alarmiert", "Personal"),
        ("2025-05-27", "Hauptkunde von {n} kündigt Rahmenvertrag", "Markt"),
        ("2025-04-15", "{n}: Finanzvorstand tritt zurück", "Management"),
    ],
    "quality": [
        ("2025-06-02", "{n} ruft Bauteilcharge zurück", "Produktion"),
        ("2025-01-29", "{n} erweitert Kapazitäten in Norditalien", "Presse"),
    ],
}


def _slug(name: str) -> str:
    return "".join(ch for ch in name.lower().split()[0] if ch.isalnum())


def _interp(path: list[float], t: float) -> float:
    x = t * (len(path) - 1)
    i = min(int(x), len(path) - 2)
    return path[i] + (path[i + 1] - path[i]) * (x - i)


def _build_regular(
    idx: int, name: str, street: str, zip_code: str, city: str, country: str, commodity: int, profile: str, plants: list[str]
) -> tuple:
    rnd = random.Random(idx * 7919)
    p = PROFILES[profile]
    years = list(range(2020, 2026))
    rev0 = rnd.uniform(18, 95)
    jitter = rnd.uniform(0.88, 1.12)
    revenue, purchase = {}, {}
    for k, y in enumerate(years):
        t = k / (len(years) - 1)
        r = rev0 * (1 + p["g"]) ** k * rnd.uniform(0.97, 1.03)
        s = (p["s0"] + (p["s1"] - p["s0"]) * t) * jitter
        revenue[str(y)] = round(r, 2)
        purchase[str(y)] = round(r * s, 2)
    last = years[-1]
    base_next = purchase[str(last)] * (1 + p["plan"])
    snapshots = []
    for q in range(8):
        year = last - 1 + (q + 2) // 4
        quarter = (q + 2) % 4 + 1
        drift = (1 - q / 7) * rnd.uniform(-1, 1) * p["noise"] * 2
        vols = {}
        for k in range(1, 5):
            vols[str(last + k)] = round(base_next * (1 + drift) * (1 + p["plan"] / 3) ** (k - 1), 2)
        snapshots.append({"date": f"{year}-Q{quarter}", "volumes": vols})
    pd_history = []
    dates = ["2022-09-01", "2023-07-01", "2024-06-01", "2025-05-01"]
    for d, v in zip(dates, p["pd"]):
        pd_history.append({"date": d, "pd": round(v * jitter * rnd.uniform(0.95, 1.05), 2)})
    quality = {}
    for k, y in enumerate(years):
        t = k / (len(years) - 1)
        ppm = _interp(p["ppm"], t) * rnd.uniform(0.92, 1.08)
        quality[str(y)] = {"ppm": round(ppm), "otd": round(min(0.995, p["otd"] + (1 - t) * 0.01), 3)}

    register = {"critical": "yellow", "declining": "green", "recovering": "yellow"}.get(profile, "green")
    master = {
        "id": f"S{1000 + idx}",
        "number": f"LF-{40210 + idx * 37}",
        "name": name + DEMO_SUFFIX,
        "street": street,
        "zip": zip_code,
        "city": city,
        "country": country,
        "website": f"https://www.{_slug(name)}.example",
        "commodity": COMMODITIES[commodity],
        "buyer": BUYERS[idx % len(BUYERS)],
        "register_status": register,
        "source": "demo",
        "plant_ids": plants,
    }
    master["location"] = geo.locate(master)
    internal = {
        "as_of": f"{last}-12",
        "revenue": revenue,
        "purchase": purchase,
        "plan_snapshots": snapshots,
        "pd_history": pd_history,
        "quality": quality,
    }
    external = [
        {
            "date": d,
            "title": t.format(n=name.split()[0]),
            "source": f"news.example/{_slug(name)}",
            "url": f"https://news.example/{_slug(name)}/{d}",
            "hint": h,
        }
        for d, t, h in NEWS[profile]
    ]
    return master, internal, external


def demo_plants() -> list[dict]:
    return [{**p, "location": geo.locate(p)} for p in PLANTS]


def demo_suppliers() -> list[tuple]:
    return [_build_regular(i, *row) for i, row in enumerate(SUPPLIERS)]


def seed() -> None:
    for plant in demo_plants():
        db.upsert_plant(plant)
    for master, internal, external in demo_suppliers():
        db.upsert_supplier(master, internal, external)
