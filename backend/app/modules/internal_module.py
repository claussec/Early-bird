"""Internal Module (Figure 3).

Collects the supplier's internal data (master data, spend cube, demand planning,
quality management, risk management) into a structured dataset and computes the
KPIs that feed the Decision Module.

KPIs are calculated deterministically in code rather than by the LLM. Every KPI
carries its formula, threshold and data source so that the assessment stays
fully traceable (design target "transparency"). Data sources that are missing
for a supplier (e.g. a newly entered supplier without spend data) are skipped
and reported in `missing_sources`.
"""

from statistics import mean, pstdev

from pydantic import BaseModel

from ..i18n import SOURCE_NAMES, t
from ..llm import LLM, LLMUnavailable

# Thresholds of the standardized assessment. The 50 % customer-share limit and the
# PD "yellow area" around 2 % follow the paper.
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
SOURCES = SOURCE_NAMES


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


def _spend_years(data: dict) -> list[int]:
    """Years for which both supplier revenue and purchasing volume are known."""
    revenue, purchase = data.get("revenue") or {}, data.get("purchase") or {}
    return sorted(int(y) for y in revenue if y in purchase and revenue[y])


def revenue_forecast(data: dict) -> list[dict]:
    """Projects supplier revenue for the next years.

    Revenue = planned purchasing volume of the buying organization (demand planning)
            + the supplier's other business, extrapolated with its historical CAGR
              (capped at +/-5 % p.a.).
    """
    years = _spend_years(data)
    snapshots = data.get("plan_snapshots") or []
    if not years or not snapshots:
        return []
    first, last = years[0], years[-1]
    other_first = data["revenue"][str(first)] - data["purchase"][str(first)]
    other_last = data["revenue"][str(last)] - data["purchase"][str(last)]
    g = max(-OTHER_BUSINESS_GROWTH_CAP, min(OTHER_BUSINESS_GROWTH_CAP, _cagr(other_first, other_last, last - first)))
    plan = snapshots[-1]["volumes"]
    out = []
    for k in range(1, FORECAST_HORIZON + 1):
        y = last + k
        if str(y) not in plan:
            break
        other = max(0.0, other_last * (1 + g) ** k)
        out.append(
            {
                "year": y,
                "revenue": round(plan[str(y)] + other, 2),
                "purchase": round(plan[str(y)], 2),
                "customer_share": round(plan[str(y)] / (plan[str(y)] + other), 4) if plan[str(y)] + other else 0,
            }
        )
    return out


def _spend_kpis(data: dict, years: list[int], lang: str) -> list[dict]:
    rev = {int(y): v for y, v in data["revenue"].items()}
    pur = {int(y): v for y, v in data["purchase"].items()}
    first, last = years[0], years[-1]
    share = pur[last] / rev[last]
    kpis = [
        {
            "id": "customer_share",
            "label": t(lang, "kpi.customer_share"),
            "group": "dependency",
            "value": round(share * 100, 1),
            "unit": "%",
            "status": _status_high_is_bad(share, "customer_share"),
            "formula": t(lang, "kpi.customer_share.formula", last=last, pur=pur[last], rev=rev[last]),
            "threshold": t(lang, "kpi.customer_share.threshold"),
            "source": "Spend Cube",
        }
    ]
    if len(years) < 2:
        return kpis
    ref = max(first, last - 3)
    delta_pp = (share - pur[ref] / rev[ref]) * 100
    kpis.append(
        {
            "id": "customer_share_delta",
            "label": t(lang, "kpi.customer_share_delta", ref=ref),
            "group": "dependency",
            "value": round(delta_pp, 1),
            "unit": "pp",
            "status": _status_high_is_bad(delta_pp, "customer_share_delta_pp"),
            "formula": t(lang, "kpi.customer_share_delta.formula", last=last, ref=ref),
            "threshold": t(lang, "kpi.customer_share_delta.threshold"),
            "source": "Spend Cube",
        }
    )
    cagr = _cagr(rev[first], rev[last], last - first)
    kpis.append(
        {
            "id": "revenue_cagr",
            "label": t(lang, "kpi.revenue_cagr", first=first, last=last),
            "group": "revenue",
            "value": round(cagr * 100, 1),
            "unit": "%",
            "status": "ok" if cagr >= 0 else ("warn" if cagr > -0.05 else "critical"),
            "formula": f"({rev[last]:.2f} / {rev[first]:.2f})^(1/{last - first}) − 1",
            "threshold": t(lang, "kpi.revenue_cagr.threshold"),
            "source": "Spend Cube",
        }
    )
    return kpis


def _plan_kpis(data: dict, years: list[int], forecast: list[dict], lang: str) -> list[dict]:
    snapshots = data.get("plan_snapshots") or []
    if not snapshots or not years:
        return []
    last = years[-1]
    rev_last = data["revenue"][str(last)]
    pur_last = data["purchase"][str(last)]
    kpis = []
    if forecast:
        fc_change = forecast[0]["revenue"] / rev_last - 1
        kpis.append(
            {
                "id": "revenue_forecast",
                "label": t(lang, "kpi.revenue_forecast", year=forecast[0]["year"]),
                "group": "revenue",
                "value": round(fc_change * 100, 2),
                "unit": "%",
                "status": _status_low_is_bad(fc_change, "revenue_forecast_change"),
                "formula": t(lang, "kpi.revenue_forecast.formula", year=forecast[0]["year"], fc=forecast[0]["revenue"], rev=rev_last),
                "threshold": t(lang, "kpi.revenue_forecast.threshold"),
                "source": "Spend Cube + Demand Planning",
            }
        )
    next_year = str(last + 1)
    plan_next = snapshots[-1]["volumes"].get(next_year)
    if plan_next is not None and pur_last:
        plan_change = plan_next / pur_last - 1
        kpis.append(
            {
                "id": "plan_change",
                "label": t(lang, "kpi.plan_change", year=next_year),
                "group": "planning",
                "value": round(plan_change * 100, 1),
                "unit": "%",
                "status": _status_low_is_bad(plan_change, "plan_change_next"),
                "formula": t(lang, "kpi.plan_change.formula", year=next_year, last=last, plan=plan_next, pur=pur_last),
                "threshold": t(lang, "kpi.plan_change.threshold"),
                "source": "Demand Planning",
            }
        )
    revisions = [s["volumes"][next_year] for s in snapshots if next_year in s["volumes"]]
    if len(revisions) >= 3 and mean(revisions) > 0:
        vol = pstdev(revisions) / mean(revisions)
        kpis.append(
            {
                "id": "plan_volatility",
                "label": t(lang, "kpi.plan_volatility", year=next_year),
                "group": "planning",
                "value": round(vol * 100, 1),
                "unit": "%",
                "status": _status_high_is_bad(vol, "plan_volatility"),
                "formula": t(lang, "kpi.plan_volatility.formula", n=len(revisions)),
                "threshold": t(lang, "kpi.plan_volatility.threshold"),
                "source": "Demand Planning",
            }
        )
    return kpis


def _rating_kpis(pd_hist: list[dict], as_of: str, lang: str) -> list[dict]:
    if not pd_hist:
        return []
    pd_latest = pd_hist[-1]
    kpis = [
        {
            "id": "pd_latest",
            "label": t(lang, "kpi.pd_latest"),
            "group": "rating",
            "value": pd_latest["pd"],
            "unit": "%",
            "status": _status_high_is_bad(pd_latest["pd"], "pd_latest"),
            "formula": t(lang, "kpi.pd_latest.formula", date=pd_latest["date"]),
            "threshold": t(lang, "kpi.pd_latest.threshold"),
            "source": "Risk Management (Coface)",
        }
    ]
    if len(pd_hist) < 2:
        return kpis
    window = [p for p in pd_hist if _months_between(p["date"], as_of) <= 48]
    base = window[0] if len(window) > 1 else pd_hist[0]
    pd_change = pd_latest["pd"] - base["pd"]
    kpis.append(
        {
            "id": "pd_trend",
            "label": t(lang, "kpi.pd_trend", date=base["date"][:7]),
            "group": "rating",
            "value": round(pd_change, 2),
            "unit": "pp",
            "status": _status_high_is_bad(pd_change, "pd_change_pp"),
            "formula": f"{pd_latest['pd']} % − {base['pd']} %",
            "threshold": t(lang, "kpi.pd_trend.threshold"),
            "source": "Risk Management (Coface)",
        }
    )
    gap = max(_months_between(a["date"], b["date"]) for a, b in zip(pd_hist, pd_hist[1:]))
    kpis.append(
        {
            "id": "rating_gap",
            "label": t(lang, "kpi.rating_gap"),
            "group": "rating",
            "value": gap,
            "unit": t(lang, "unit.months"),
            "status": _status_high_is_bad(gap, "rating_staleness_months"),
            "formula": t(lang, "kpi.rating_gap.formula", n=len(window)),
            "threshold": t(lang, "kpi.rating_gap.threshold"),
            "source": "Risk Management (Coface)",
        }
    )
    return kpis


def _quality_kpis(quality: dict, lang: str) -> list[dict]:
    q = {int(y): v for y, v in quality.items()}
    qy = sorted(q)
    if not qy:
        return []
    kpis = []
    latest = q[qy[-1]]
    if latest.get("ppm") is not None:
        prev = [q[y]["ppm"] for y in qy[-3:-1] if q[y].get("ppm") is not None]
        ppm_change = latest["ppm"] / mean(prev) - 1 if prev and mean(prev) > 0 else 0.0
        kpis.append(
            {
                "id": "ppm",
                "label": t(lang, "kpi.ppm"),
                "group": "quality",
                "value": latest["ppm"],
                "unit": "ppm",
                "status": _status_high_is_bad(ppm_change, "ppm_change"),
                "formula": t(lang, "kpi.ppm.formula", change=ppm_change * 100) if prev else t(lang, "kpi.ppm.no_history"),
                "threshold": t(lang, "kpi.ppm.threshold"),
                "source": "Quality Management",
            }
        )
    if latest.get("otd") is not None:
        kpis.append(
            {
                "id": "otd",
                "label": t(lang, "kpi.otd"),
                "group": "quality",
                "value": round(latest["otd"] * 100, 1),
                "unit": "%",
                "status": _status_low_is_bad(latest["otd"], "otd_latest"),
                "formula": t(lang, "kpi.otd.formula", year=qy[-1]),
                "threshold": t(lang, "kpi.otd.threshold"),
                "source": "Quality Management",
            }
        )
    return kpis


def compute_kpis(data: dict, lang: str = "de") -> dict:
    as_of = data.get("as_of") or ""
    years = _spend_years(data)
    pd_hist = sorted(data.get("pd_history") or [], key=lambda p: p["date"])
    if not as_of:
        candidates = [f"{years[-1]}-12"] if years else []
        candidates += [p["date"][:7] for p in pd_hist[-1:]]
        as_of = max(candidates) if candidates else ""
    forecast = revenue_forecast(data)

    kpis = (
        (_spend_kpis(data, years, lang) if years else [])
        + _plan_kpis(data, years, forecast, lang)
        + _rating_kpis(pd_hist, as_of, lang)
        + _quality_kpis(data.get("quality") or {}, lang)
    )
    available = {k["source"].split(" + ")[0] for k in kpis} | {
        "Demand Planning" for k in kpis if "Demand Planning" in k["source"]
    }
    snapshots = data.get("plan_snapshots") or []
    next_year = str(years[-1] + 1) if years else ""
    return {
        "as_of": as_of,
        "kpis": kpis,
        "forecast": forecast,
        "missing_sources": [s for s in SOURCES if s not in available],
        "series": {
            "years": years,
            "revenue": [data["revenue"][str(y)] for y in years],
            "purchase": [data["purchase"][str(y)] for y in years],
            "customer_share": [round(data["purchase"][str(y)] / data["revenue"][str(y)] * 100, 1) for y in years],
            "pd_history": pd_hist,
            "plan_revisions": [
                {"date": s["date"], "volume": s["volumes"][next_year]} for s in snapshots if next_year in s["volumes"]
            ],
        },
    }


# --- AI Agent "Internal Data": decision "Risk?" (Figure 2) --------------------------------


class RiskCheck(BaseModel):
    risk: bool
    reasoning: str


SYSTEM_RISK = (
    "You are the AI agent 'Internal Data' of an early-warning system for financially critical suppliers in "
    "automotive purchasing. You receive a supplier's key figures computed from internal systems, each with "
    "formula, threshold and source. Decide whether there are signs of a financial risk (risk = true), so that the "
    "supplier is analysed in depth in the Decision Module, or whether it is re-evaluated next quarter "
    "(risk = false). Give a short, factual reasoning that cites the specific key figures. Do not invent values "
    "and do not assign a score."
)


def rule_risk_check(kpis: list[dict], lang: str = "de") -> RiskCheck:
    flagged = [k for k in kpis if k["status"] != "ok"]
    if not kpis:
        return RiskCheck(risk=False, reasoning=t(lang, "risk.no_kpis"))
    if not flagged:
        return RiskCheck(risk=False, reasoning=t(lang, "risk.all_ok"))
    listed = "; ".join(
        t(lang, "risk.item", label=k["label"], value=k["value"], unit=k["unit"], threshold=k["threshold"]) for k in flagged[:5]
    )
    return RiskCheck(risk=True, reasoning=t(lang, "risk.flagged", n=len(flagged), listed=listed))


def risk_check(master: dict, kpis: list[dict], llm: LLM, lang: str = "de") -> tuple[RiskCheck, str]:
    """The Internal Module's AI agent decides whether the supplier goes into the Decision Module."""
    if not kpis:
        return rule_risk_check(kpis, lang), t(lang, "method.rules")
    try:
        listing = "\n".join(
            f"- {k['label']}: {k['value']} {k['unit']} – {k['formula']} ({k['threshold']}; {k['source']})" for k in kpis
        )
        prompt = f"{t(lang, 'language')}\n\nSupplier: {master['name']} ({master['commodity']}).\n\nKey figures:\n{listing}"
        return llm.structured(SYSTEM_RISK, prompt, RiskCheck), llm.label
    except LLMUnavailable:
        return rule_risk_check(kpis, lang), t(lang, "method.rules")
