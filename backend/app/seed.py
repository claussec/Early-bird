"""Synthetic demo data.

All companies are fictitious. The case-study supplier reconstructs the
application example from the paper (sub-supplier for metal components, data
available until end of 2019). The figures published in the paper are used
as-is (revenue 2014/2019, customer-share 62.8 %, PD 0.7 % -> 2 %, forecast
2020 = 30.28 Mio. €). The actual 2020–2023 revenues were published only as an
index, so they are reconstructed here to reproduce the reported MAPE of
about 2.4 % and are marked as illustrative.
"""

import random

from . import db
from .modules.internal_module import revenue_forecast

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

# name, city, country, commodity, profile
SUPPLIERS = [
    ("Kessler Umformtechnik GmbH", "Pforzheim", "DE", 0, "healthy"),
    ("Brandt Präzisionsguss GmbH", "Aalen", "DE", 0, "dependency"),
    ("Vogtland Stanztechnik GmbH", "Plauen", "DE", 0, "critical"),
    ("Moravia Forge s.r.o.", "Brno", "CZ", 0, "recovering"),
    ("NordElektra Components AG", "Kiel", "DE", 1, "healthy"),
    ("Silesia Cable Systems Sp. z o.o.", "Katowice", "PL", 1, "declining"),
    ("Alpen Sensorik GmbH", "Graz", "AT", 1, "hidden"),
    ("Lombarda Elettronica S.p.A.", "Bergamo", "IT", 1, "quality"),
    ("Rheinpolymer GmbH", "Ludwigshafen", "DE", 2, "declining"),
    ("Danubia Plastics Kft.", "Győr", "HU", 2, "healthy"),
    ("Iberflex Sellados S.L.", "Zaragoza", "ES", 2, "dependency"),
    ("Hohenlohe Antriebstechnik GmbH", "Künzelsau", "DE", 3, "healthy"),
    ("Carpathia Gears S.R.L.", "Sibiu", "RO", 3, "critical"),
    ("Saxonia Lager & Wellen GmbH", "Chemnitz", "DE", 3, "recovering"),
    ("Neckar Galvanik GmbH", "Heilbronn", "DE", 4, "hidden"),
    ("Bohemia Coatings a.s.", "Pilsen", "CZ", 4, "quality"),
]

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


def _build_regular(idx: int, name: str, city: str, country: str, commodity: int, profile: str) -> tuple:
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
        "name": name,
        "city": city,
        "country": country,
        "website": f"https://www.{_slug(name)}.example",
        "commodity": COMMODITIES[commodity],
        "buyer": BUYERS[idx % len(BUYERS)],
        "register_status": register,
        "is_case_study": False,
    }
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


def _build_case_study() -> tuple:
    years = list(range(2014, 2020))
    revenue = {"2014": 25.93, "2015": 27.40, "2016": 29.12, "2017": 31.05, "2018": 33.10, "2019": 34.85}
    shares = [0.52, 0.54, 0.56, 0.585, 0.605, 0.628]
    purchase = {str(y): round(revenue[str(y)] * s, 3) for y, s in zip(years, shares)}
    internal = {
        "as_of": "2019-12",
        "revenue": revenue,
        "purchase": purchase,
        "plan_snapshots": [],
        # Only two tracked rating changes, as described in the paper.
        "pd_history": [{"date": "2014-06-01", "pd": 0.7}, {"date": "2019-09-01", "pd": 2.0}],
        "quality": {str(y): {"ppm": v, "otd": 0.972} for y, v in zip(years, [48, 51, 47, 50, 49, 52])},
    }
    # Plan volumes are calibrated so that the revenue forecast for 2020 equals the
    # 30.28 Mio. € reported in the paper; the planning volatility is visible across plan revisions.
    other_2019 = revenue["2019"] - purchase["2019"]
    other_2014 = revenue["2014"] - purchase["2014"]
    g = (other_2019 / other_2014) ** (1 / 5) - 1
    plan_2020 = 30.28 - other_2019 * (1 + g)
    final = {
        "2020": round(plan_2020, 3),
        "2021": round(plan_2020 * 1.03, 3),
        "2022": round(plan_2020 * 1.05, 3),
        "2023": round(plan_2020 * 1.07, 3),
    }
    revisions = [1.22, 1.30, 1.08, 1.25, 0.96, 1.10, 0.92, 1.0]
    labels = ["2018-Q2", "2018-Q3", "2018-Q4", "2019-Q1", "2019-Q2", "2019-Q3", "2019-Q4", "2019-Q4"]
    internal["plan_snapshots"] = [
        {"date": lab, "volumes": {y: round(v * f, 3) for y, v in final.items()}}
        for lab, f in zip(labels, revisions)
    ]

    forecast = revenue_forecast(internal)
    # Reconstructed actuals (index values only in the paper) with deviations giving MAPE ≈ 2.4 %.
    deviations = [-0.0297, 0.018, -0.027, 0.019]
    actual_shares = [0.645, 0.665, 0.682, 0.70]
    actual = []
    for f, e, s in zip(forecast, deviations, actual_shares):
        r = round(f["revenue"] * (1 + e), 2)
        actual.append({"year": f["year"], "revenue": r, "customer_share": s})
    master = {
        "id": "S0999",
        "number": "LF-19019",
        "name": "Sublieferant M (Fallstudie, anonymisiert)",
        "city": "Süddeutschland",
        "country": "DE",
        "website": "",
        "commodity": COMMODITIES[0],
        "buyer": BUYERS[0],
        "register_status": "yellow",
        "is_case_study": True,
        "case_study": {
            "description": (
                "Rekonstruktion des Anwendungsbeispiels aus dem Paper: mittelständischer Hersteller von "
                "Metallkomponenten mit Datenstand Ende 2019. Die Ist-Werte 2020–2023 sind im Paper nur "
                "indexiert veröffentlicht und hier illustrativ rekonstruiert."
            ),
            "actual": actual,
            "actual_pd": [
                {"date": "2020-06-01", "pd": 2.0},
                {"date": "2021-06-01", "pd": 3.0},
                {"date": "2022-06-01", "pd": 4.0},
            ],
            "paper_table": [
                ["Customer-Share (Abhängigkeit)", "62,8 %, kritisch markiert", "Stieg von ~63 % auf ~70 %", "Bestätigt"],
                ["Umsatzentwicklung", "−13,12 % prognostiziert", "Eng getroffen (MAPE 2,37 %)", "Bestätigt"],
                ["Coface-PD-Rating", "Steigendes Ausfallrisiko (0,7 % → 2 %)", "Verschlechterte sich wie prognostiziert", "Bestätigt"],
                ["Volatilität Planvolumen", "Als volatil markiert → Planungsunsicherheit", "Volatilität nahm zu", "Bestätigt"],
                ["Qualitätskennzahlen", "Stabil, keine Qualitätsbedenken", "Blieben stabil", "Bestätigt"],
            ],
        },
    }
    return master, internal, []


def seed() -> None:
    master, internal, external = _build_case_study()
    db.upsert_supplier(master, internal, external)
    for i, (name, city, country, commodity, profile) in enumerate(SUPPLIERS):
        master, internal, external = _build_regular(i, name, city, country, commodity, profile)
        db.upsert_supplier(master, internal, external)
