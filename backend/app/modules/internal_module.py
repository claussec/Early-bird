"""Internal Module (Figure 3).

Collects the supplier's internal data (master data, spend cube, demand planning,
quality management, risk management) into a structured dataset and computes the
KPIs that feed the Decision Module.

KPIs are calculated deterministically in code rather than by the LLM. Every KPI
carries its formula, threshold and data source so that the assessment stays
fully traceable (design target "transparency").
"""

from statistics import mean, pstdev

# Thresholds of the standardized assessment. The 50 % customer-share limit and the
# PD "yellow area" around 2 % follow the case study in the paper.
THRESHOLDS = {
    "customer_share": {"warn": 0.30, "critical": 0.50},
    "customer_share_delta_pp": {"warn": 5.0, "critical": 10.0},
    "revenue_forecast_change": {"warn": -0.05, "critical": -0.10},
    "plan_change_next": {"warn": -0.08, "critical": -0.15},
    "plan_volatility": {"warn": 0.08, "critical": 0.15},
    "pd_latest": {"warn": 1.0, "critical": 3.0},
    "pd_change_pp": {"warn": 0.5, "critical": 1.0},
    "rating_staleness_months": {"warn": 12, "critical": 24},
    "ppm_change": {"warn": 0.25, "critical": 0.60},
    "otd_latest": {"warn": 0.95, "critical": 0.90},
}

FORECAST_HORIZON = 4
OTHER_BUSINESS_GROWTH_CAP = 0.05


def _status_high_is_bad(value: float, key: str) -> str:
    t = THRESHOLDS[key]
    if value >= t["critical"]:
        return "critical"
    if value >= t["warn"]:
        return "warn"
    return "ok"


def _status_low_is_bad(value: float, key: str) -> str:
    t = THRESHOLDS[key]
    if value <= t["critical"]:
        return "critical"
    if value <= t["warn"]:
        return "warn"
    return "ok"


def _months_between(a: str, b: str) -> int:
    ya, ma = int(a[:4]), int(a[5:7])
    yb, mb = int(b[:4]), int(b[5:7])
    return (yb - ya) * 12 + (mb - ma)


def _cagr(first: float, last: float, years: int) -> float:
    if first <= 0 or years <= 0:
        return 0.0
    return (last / first) ** (1 / years) - 1


def revenue_forecast(data: dict) -> list[dict]:
    """Projects supplier revenue for the next years.

    Revenue = planned purchasing volume of the buying organization (demand planning)
            + the supplier's other business, extrapolated with its historical CAGR
              (capped at +/-5 % p.a.).
    """
    years = sorted(int(y) for y in data["revenue"])
    first, last = years[0], years[-1]
    other_first = data["revenue"][str(first)] - data["purchase"][str(first)]
    other_last = data["revenue"][str(last)] - data["purchase"][str(last)]
    g = max(-OTHER_BUSINESS_GROWTH_CAP, min(OTHER_BUSINESS_GROWTH_CAP, _cagr(other_first, other_last, last - first)))
    plan = data["plan_snapshots"][-1]["volumes"]
    out = []
    for k in range(1, FORECAST_HORIZON + 1):
        y = last + k
        if str(y) not in plan:
            break
        other = other_last * (1 + g) ** k
        out.append(
            {
                "year": y,
                "revenue": round(plan[str(y)] + other, 2),
                "purchase": round(plan[str(y)], 2),
                "customer_share": round(plan[str(y)] / (plan[str(y)] + other), 4),
            }
        )
    return out


def compute_kpis(data: dict) -> dict:
    as_of = data["as_of"]
    years = sorted(int(y) for y in data["revenue"])
    last, first = years[-1], years[0]
    rev = {int(y): v for y, v in data["revenue"].items()}
    pur = {int(y): v for y, v in data["purchase"].items()}
    kpis: list[dict] = []

    # --- Dependency (Spend Cube) ---------------------------------------------------
    share = pur[last] / rev[last]
    kpis.append(
        {
            "id": "customer_share",
            "label": "Customer-Share",
            "group": "Abhängigkeit",
            "value": round(share * 100, 1),
            "unit": "%",
            "status": _status_high_is_bad(share, "customer_share"),
            "formula": f"Einkaufsvolumen {last} / Lieferantenumsatz {last} = {pur[last]:.2f} / {rev[last]:.2f} Mio. €",
            "threshold": "Warnung ≥ 30 %, kritisch ≥ 50 %",
            "source": "Spend Cube",
        }
    )
    ref = max(first, last - 3)
    delta_pp = (share - pur[ref] / rev[ref]) * 100
    kpis.append(
        {
            "id": "customer_share_delta",
            "label": f"Veränderung Customer-Share seit {ref}",
            "group": "Abhängigkeit",
            "value": round(delta_pp, 1),
            "unit": "pp",
            "status": _status_high_is_bad(delta_pp, "customer_share_delta_pp"),
            "formula": f"Customer-Share {last} − Customer-Share {ref}",
            "threshold": "Warnung ≥ +5 pp, kritisch ≥ +10 pp",
            "source": "Spend Cube",
        }
    )

    # --- Revenue development ---------------------------------------------------------
    cagr = _cagr(rev[first], rev[last], last - first)
    kpis.append(
        {
            "id": "revenue_cagr",
            "label": f"Umsatz-CAGR {first}–{last}",
            "group": "Umsatz",
            "value": round(cagr * 100, 1),
            "unit": "%",
            "status": "ok" if cagr >= 0 else ("warn" if cagr > -0.05 else "critical"),
            "formula": f"({rev[last]:.2f} / {rev[first]:.2f})^(1/{last - first}) − 1",
            "threshold": "Warnung < 0 %, kritisch ≤ −5 % p.a.",
            "source": "Spend Cube",
        }
    )
    forecast = revenue_forecast(data)
    if forecast:
        fc_change = forecast[0]["revenue"] / rev[last] - 1
        kpis.append(
            {
                "id": "revenue_forecast",
                "label": f"Umsatzprognose {forecast[0]['year']}",
                "group": "Umsatz",
                "value": round(fc_change * 100, 2),
                "unit": "%",
                "status": _status_low_is_bad(fc_change, "revenue_forecast_change"),
                "formula": (
                    f"Planvolumen {forecast[0]['year']} + fortgeschriebenes Fremdgeschäft "
                    f"= {forecast[0]['revenue']:.2f} Mio. € vs. {rev[last]:.2f} Mio. €"
                ),
                "threshold": "Warnung ≤ −5 %, kritisch ≤ −10 %",
                "source": "Spend Cube + Demand Planning",
            }
        )

    # --- Demand planning -------------------------------------------------------------
    snapshots = data["plan_snapshots"]
    next_year = str(last + 1)
    plan_next = snapshots[-1]["volumes"].get(next_year)
    if plan_next is not None:
        plan_change = plan_next / pur[last] - 1
        kpis.append(
            {
                "id": "plan_change",
                "label": f"Geplantes Einkaufsvolumen {next_year}",
                "group": "Planung",
                "value": round(plan_change * 100, 1),
                "unit": "%",
                "status": _status_low_is_bad(plan_change, "plan_change_next"),
                "formula": f"Plan {next_year} / Ist {last} − 1 = {plan_next:.2f} / {pur[last]:.2f}",
                "threshold": "Warnung ≤ −8 %, kritisch ≤ −15 %",
                "source": "Demand Planning",
            }
        )
    revisions = [s["volumes"][next_year] for s in snapshots if next_year in s["volumes"]]
    if len(revisions) >= 3:
        vol = pstdev(revisions) / mean(revisions)
        kpis.append(
            {
                "id": "plan_volatility",
                "label": f"Volatilität Planvolumen {next_year}",
                "group": "Planung",
                "value": round(vol * 100, 1),
                "unit": "%",
                "status": _status_high_is_bad(vol, "plan_volatility"),
                "formula": f"Variationskoeffizient über {len(revisions)} Planstände",
                "threshold": "Warnung ≥ 8 %, kritisch ≥ 15 %",
                "source": "Demand Planning",
            }
        )

    # --- External credit rating (Risk Management) -----------------------------------
    pd_hist = sorted(data["pd_history"], key=lambda p: p["date"])
    pd_latest = pd_hist[-1]
    kpis.append(
        {
            "id": "pd_latest",
            "label": "Coface-Ausfallwahrscheinlichkeit (PD)",
            "group": "Rating",
            "value": pd_latest["pd"],
            "unit": "%",
            "status": _status_high_is_bad(pd_latest["pd"], "pd_latest"),
            "formula": f"Letzter Ratingstand vom {pd_latest['date']}",
            "threshold": "Gelb ≥ 1 %, rot ≥ 3 %",
            "source": "Risk Management (Coface)",
        }
    )
    window = [p for p in pd_hist if _months_between(p["date"], as_of) <= 48]
    base = window[0] if len(window) > 1 else pd_hist[0]
    pd_change = pd_latest["pd"] - base["pd"]
    kpis.append(
        {
            "id": "pd_trend",
            "label": f"PD-Trend seit {base['date'][:7]}",
            "group": "Rating",
            "value": round(pd_change, 2),
            "unit": "pp",
            "status": _status_high_is_bad(pd_change, "pd_change_pp"),
            "formula": f"{pd_latest['pd']} % − {base['pd']} %",
            "threshold": "Warnung ≥ +0,5 pp, kritisch ≥ +1 pp",
            "source": "Risk Management (Coface)",
        }
    )
    updates_48m = len(window)
    staleness = _months_between(pd_hist[-2]["date"], pd_latest["date"]) if len(pd_hist) > 1 else 0
    kpis.append(
        {
            "id": "rating_gap",
            "label": "Längste Lücke zwischen Ratingständen",
            "group": "Rating",
            "value": staleness,
            "unit": "Monate",
            "status": _status_high_is_bad(staleness, "rating_staleness_months"),
            "formula": f"{updates_48m} Ratingstände in 48 Monaten",
            "threshold": "Warnung ≥ 12 Monate, kritisch ≥ 24 Monate",
            "source": "Risk Management (Coface)",
        }
    )

    # --- Quality management ----------------------------------------------------------
    q = {int(y): v for y, v in data["quality"].items()}
    qy = sorted(q)
    prev = [q[y]["ppm"] for y in qy[-3:-1]]
    ppm_change = q[qy[-1]]["ppm"] / mean(prev) - 1 if prev and mean(prev) > 0 else 0.0
    kpis.append(
        {
            "id": "ppm",
            "label": "Reklamationsquote (ppm)",
            "group": "Qualität",
            "value": q[qy[-1]]["ppm"],
            "unit": "ppm",
            "status": _status_high_is_bad(ppm_change, "ppm_change"),
            "formula": f"Veränderung ggü. Ø Vorjahre: {ppm_change * 100:+.0f} %",
            "threshold": "Warnung ≥ +25 %, kritisch ≥ +60 % ggü. Vorjahren",
            "source": "Quality Management",
        }
    )
    otd = q[qy[-1]]["otd"]
    kpis.append(
        {
            "id": "otd",
            "label": "Liefertreue",
            "group": "Qualität",
            "value": round(otd * 100, 1),
            "unit": "%",
            "status": _status_low_is_bad(otd, "otd_latest"),
            "formula": f"Pünktliche Lieferungen {qy[-1]}",
            "threshold": "Warnung ≤ 95 %, kritisch ≤ 90 %",
            "source": "Quality Management",
        }
    )

    return {
        "as_of": as_of,
        "kpis": kpis,
        "forecast": forecast,
        "series": {
            "years": years,
            "revenue": [rev[y] for y in years],
            "purchase": [pur[y] for y in years],
            "customer_share": [round(pur[y] / rev[y] * 100, 1) for y in years],
            "pd_history": pd_hist,
            "plan_revisions": [{"date": s["date"], "volume": s["volumes"][next_year]} for s in snapshots if next_year in s["volumes"]],
        },
    }
