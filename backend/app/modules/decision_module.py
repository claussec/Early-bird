"""Decision Module (Figure 4).

A preset task list guides the AI agent through the steps in sequence:
  1. Mapping indicators   – every data point becomes a risk or success indicator (standardized matrix)
  2. Cross-referencing     – indicators are relativized and combined; financial signals are prioritized
  3. Argumentation         – a traceable chain of arguments is generated
  4. AI decision making    – traffic light and escalation decision
The escalation itself (notification to the buyer) is handled by the pipeline.
"""

import math
from typing import Literal

from pydantic import BaseModel

from ..llm import LLM, LLMUnavailable

# Financial signals are prioritized over quality signals (paper, "Interpretation of results").
GROUP_WEIGHTS = {
    "Rating": 1.0,
    "Umsatz": 0.9,
    "Abhängigkeit": 0.9,
    "Planung": 0.7,
    "Extern": 0.6,
    "Qualität": 0.4,
}
KPI_WEIGHT_OVERRIDES = {"rating_gap": 0.5, "revenue_cagr": 0.6}
STATUS_SEVERITY = {"critical": 1.0, "warn": 0.5}
COMBINATION_BONUS = 0.75
SCORE_SCALE = 3.0
LIGHTS = ["green", "yellow", "red"]
LIGHT_DE = {"green": "Grün", "yellow": "Gelb", "red": "Rot"}


def light_for(score: int) -> str:
    if score >= 60:
        return "red"
    if score >= 35:
        return "yellow"
    return "green"


# --- Step 1: Mapping indicators ---------------------------------------------------------


def _success(kpi: dict) -> bool:
    v = kpi["value"]
    return {
        "customer_share": v < 20,
        "customer_share_delta": v <= -2,
        "revenue_cagr": v >= 3,
        "revenue_forecast": v >= 3,
        "plan_change": v >= 3,
        "pd_latest": v < 0.5,
        "pd_trend": v <= -0.5,
    }.get(kpi["id"], False)


def map_indicators(kpis: list[dict], external: list[dict], as_of: str) -> list[dict]:
    indicators = []
    for k in kpis:
        weight = KPI_WEIGHT_OVERRIDES.get(k["id"], GROUP_WEIGHTS[k["group"]])
        if k["status"] in STATUS_SEVERITY:
            kind, severity = "risk", STATUS_SEVERITY[k["status"]]
        elif _success(k):
            kind, severity = "success", 0.5
        else:
            kind, severity = "neutral", 0.0
        indicators.append(
            {
                "id": k["id"],
                "label": k["label"],
                "group": k["group"],
                "type": kind,
                "severity": severity,
                "weight": weight,
                "points": round(weight * severity, 2),
                "value": f"{k['value']} {k['unit']}",
                "source": k["source"],
                "evidence": k["formula"],
            }
        )
    ref_year = int(as_of[:4])
    for i, doc in enumerate(external):
        if doc["signal"] == "neutral":
            continue
        # Relativize: older documents count less (−25 % per year, floor 25 %).
        age = max(0, ref_year - int(doc["date"][:4])) if doc.get("date") else 1
        recency = max(0.25, 1 - 0.25 * age)
        severity = doc["severity"] / 3
        indicators.append(
            {
                "id": f"ext_{i}",
                "label": doc["title"],
                "group": "Extern",
                "category": doc["category"],
                "type": doc["signal"],
                "severity": round(severity, 2),
                "weight": round(GROUP_WEIGHTS["Extern"] * recency, 2),
                "points": round(GROUP_WEIGHTS["Extern"] * recency * severity, 2),
                "value": doc["category"],
                "source": doc.get("source", "Web"),
                "evidence": doc["rationale"],
                "date": doc.get("date", ""),
                "url": doc.get("url", ""),
            }
        )
    return indicators


# --- Step 2: Cross-referencing ----------------------------------------------------------


def cross_reference(indicators: list[dict]) -> list[dict]:
    by_id = {i["id"]: i for i in indicators}

    def risk(i: str) -> bool:
        return i in by_id and by_id[i]["type"] == "risk"

    ext_risk = [i for i in indicators if i["group"] == "Extern" and i["type"] == "risk"]
    internal_fin_risk = [i for i in indicators if i["group"] in ("Rating", "Umsatz") and i["type"] == "risk"]
    combos = []
    if risk("customer_share") and (risk("revenue_forecast") or risk("plan_change")):
        ids = [x for x in ("customer_share", "revenue_forecast", "plan_change") if risk(x)]
        combos.append(
            {
                "id": "dependency_decline",
                "title": "Abhängigkeitsfalle",
                "description": "Hoher Customer-Share trifft auf rückläufiges Volumen: Der Umsatzrückgang beim Hauptkunden "
                "schlägt nahezu ungedämpft auf den Gesamtumsatz des Lieferanten durch.",
                "indicator_ids": ids,
            }
        )
    if (risk("pd_trend") or risk("pd_latest")) and risk("plan_volatility"):
        combos.append(
            {
                "id": "rating_planning",
                "title": "Rating-Verschlechterung bei Planungsunsicherheit",
                "description": "Steigende Ausfallwahrscheinlichkeit bei gleichzeitig volatiler Volumenplanung: "
                "Der Lieferant kann Kapazitäten und Liquidität schlecht planen.",
                "indicator_ids": [x for x in ("pd_latest", "pd_trend", "plan_volatility") if risk(x)],
            }
        )
    if risk("rating_gap") and risk("pd_trend"):
        combos.append(
            {
                "id": "rating_lag",
                "title": "Verzögertes externes Rating",
                "description": "Das externe Rating wurde selten aktualisiert, zeigt aber einen deutlichen Sprung. "
                "Die tatsächliche Verschlechterung dürfte früher eingesetzt haben, als das Rating signalisiert.",
                "indicator_ids": ["rating_gap", "pd_trend"],
            }
        )
    if ext_risk and internal_fin_risk:
        combos.append(
            {
                "id": "external_confirms",
                "title": "Externe Signale bestätigen interne Befunde",
                "description": "Web-Meldungen deuten in dieselbe Richtung wie die internen Finanzkennzahlen.",
                "indicator_ids": [i["id"] for i in ext_risk[:3]] + [i["id"] for i in internal_fin_risk[:2]],
            }
        )
    severe_ext = [i for i in ext_risk if i["severity"] >= 0.66]
    if len(severe_ext) >= 2 and not internal_fin_risk:
        combos.append(
            {
                "id": "divergence",
                "title": "Divergenz: Rating unauffällig, Web-Signale kritisch",
                "description": "Das externe Rating und die internen Finanzkennzahlen sind noch unauffällig, mehrere "
                "Web-Meldungen deuten jedoch auf eine Verschlechterung. Typischer Fall, den ein reines "
                "Rating-Monitoring zu spät erkennt.",
                "indicator_ids": [i["id"] for i in severe_ext[:3]],
            }
        )
    return combos


def score(indicators: list[dict], combos: list[dict]) -> dict:
    risk_pts = sum(i["points"] for i in indicators if i["type"] == "risk")
    success_pts = sum(i["points"] for i in indicators if i["type"] == "success")
    combo_pts = COMBINATION_BONUS * len(combos)
    total = max(0.0, risk_pts + combo_pts - 0.5 * success_pts)
    value = round(100 * (1 - math.exp(-total / SCORE_SCALE)))
    return {
        "score": value,
        "traffic_light": light_for(value),
        "risk_points": round(risk_pts, 2),
        "success_points": round(success_pts, 2),
        "combination_points": round(combo_pts, 2),
        "formula": f"Score = 100 · (1 − e^(−({risk_pts:.2f} + {combo_pts:.2f} − 0,5 · {success_pts:.2f}) / {SCORE_SCALE}))",
    }


# --- Step 3: Argumentation ---------------------------------------------------------------


class Argument(BaseModel):
    title: str
    direction: Literal["risk", "success"]
    reasoning: str
    indicator_ids: list[str]


class Argumentation(BaseModel):
    summary: str
    arguments: list[Argument]
    recommendation: str
    measures: list[str]


class Decision(BaseModel):
    traffic_light: Literal["green", "yellow", "red"]
    escalate: bool
    confidence: Literal["low", "medium", "high"]
    justification: str


SYSTEM_ARGUMENT = (
    "Du bist der AI Agent 'Decision Maker' eines Frühwarnsystems für finanziell kritische Lieferanten im "
    "Automotive-Einkauf. Du erhältst strukturierte, bereits berechnete Indikatoren (mit Formeln und Quellen) und "
    "Kombinationen. Erzeuge eine nachvollziehbare Argumentationskette für den verantwortlichen Einkäufer: "
    "Jedes Argument muss sich auf konkrete indicator_ids stützen. Priorisiere Finanzsignale vor Qualitätssignalen. "
    "Erfinde keine Zahlen; verwende nur die gelieferten Werte. Schreibe sachlich auf Deutsch. "
    "Gib eine handlungsorientierte Empfehlung und 2–5 konkrete Maßnahmen."
)

SYSTEM_DECISION = (
    "Du bist der AI Agent 'Decision Maker'. Entscheide über die Ampel (green/yellow/red) und ob an den "
    "Einkäufer eskaliert wird. Der regelbasierte Score ist der Ausgangspunkt; du darfst höchstens um eine "
    "Stufe abweichen und musst jede Abweichung begründen. Eskaliere, wenn die Ampel rot ist oder sich die "
    "Einstufung gegenüber dem internen Risikoregister verschlechtert."
)


def _fmt_indicators(indicators: list[dict]) -> str:
    return "\n".join(
        f"- {i['id']} [{i['group']}, {i['type']}, Punkte {i['points']}]: {i['label']} = {i['value']} "
        f"(Quelle: {i['source']}; {i['evidence']})"
        for i in indicators
        if i["type"] != "neutral"
    )


MEASURES = {
    "customer_share": "Abhängigkeit reduzieren: Volumenplanung und Mengenzusagen mit dem Lieferanten abstimmen",
    "pd_latest": "Aktuelle Bilanz, BWA und Liquiditätsplanung beim Lieferanten anfordern",
    "pd_trend": "Aktuelle Bilanz, BWA und Liquiditätsplanung beim Lieferanten anfordern",
    "plan_volatility": "Planungssicherheit erhöhen: verbindliche Forecasts und Rahmenmengen vereinbaren",
    "revenue_forecast": "Second Source qualifizieren bzw. Dual-Sourcing vorbereiten",
    "plan_change": "Auswirkung der Volumenreduktion mit dem Lieferanten besprechen",
    "Extern": "Hintergrund der Web-Meldungen im Lieferantengespräch klären",
    "ppm": "Quality-Audit beim Lieferanten einplanen",
    "otd": "Liefertreue im Lieferantengespräch adressieren",
}


def template_argumentation(indicators: list[dict], combos: list[dict], light: str) -> Argumentation:
    by_id = {i["id"]: i for i in indicators}
    args, covered = [], set()
    for c in combos:
        args.append(
            Argument(title=c["title"], direction="risk", reasoning=c["description"], indicator_ids=c["indicator_ids"])
        )
        covered.update(c["indicator_ids"])
    risks = sorted((i for i in indicators if i["type"] == "risk"), key=lambda i: -i["points"])
    for i in risks:
        if i["id"] in covered or len(args) >= 6:
            continue
        args.append(
            Argument(
                title=i["label"],
                direction="risk",
                reasoning=f"{i['label']}: {i['value']}. {i['evidence']} (Quelle: {i['source']}).",
                indicator_ids=[i["id"]],
            )
        )
    for i in sorted((i for i in indicators if i["type"] == "success"), key=lambda i: -i["points"])[:3]:
        args.append(
            Argument(
                title=f"Stabilisierend: {i['label']}",
                direction="success",
                reasoning=f"{i['label']}: {i['value']}. {i['evidence']}.",
                indicator_ids=[i["id"]],
            )
        )
    measures = []
    for i in risks:
        m = MEASURES.get(i["id"]) or MEASURES.get(i["group"])
        if m and m not in measures:
            measures.append(m)
    n_risk = len(risks)
    top = ", ".join(i["label"] for i in risks[:3]) or "keine"
    if light == "red":
        rec = "Eskalation an den verantwortlichen Einkäufer: Lieferant sorgfältig neu bewerten, Phase-out bzw. Dual-Sourcing prüfen und das zentrale Risikomanagement einbinden."
    elif light == "yellow":
        rec = "Sorgfältige Neubewertung des Lieferanten: Lieferantengespräch führen, Finanzunterlagen anfordern und Entwicklung im nächsten Quartal eng beobachten."
    else:
        rec = "Keine Maßnahme erforderlich – reguläres quartalsweises Monitoring fortsetzen."
        measures = measures[:1]
    summary = (
        f"{n_risk} Risikoindikator(en) und {len(combos)} kritische Kombination(en) identifiziert. "
        f"Wichtigste Treiber: {top}."
    )
    if not measures:
        measures = ["Reguläres Monitoring im nächsten Quartal"]
    return Argumentation(summary=summary, arguments=args, recommendation=rec, measures=measures[:5])


def generate_argumentation(master: dict, indicators: list[dict], combos: list[dict], scoring: dict, llm: LLM):
    try:
        prompt = (
            f"Lieferant: {master['name']} ({master['commodity']}), internes Risikoregister: "
            f"{LIGHT_DE[master['register_status']]}.\n"
            f"Regelbasierter Score: {scoring['score']}/100 ({LIGHT_DE[scoring['traffic_light']]}).\n\n"
            f"Indikatoren:\n{_fmt_indicators(indicators)}\n\n"
            "Kombinationen:\n" + "\n".join(f"- {c['title']}: {c['description']} ({', '.join(c['indicator_ids'])})" for c in combos)
        )
        return llm.structured(SYSTEM_ARGUMENT, prompt, Argumentation), llm.label
    except LLMUnavailable:
        return template_argumentation(indicators, combos, scoring["traffic_light"]), "Regelbasierte Vorlage"


def rule_decision(scoring: dict, register_status: str, combos: list[dict]) -> Decision:
    light = scoring["traffic_light"]
    worse = LIGHTS.index(light) > LIGHTS.index(register_status)
    escalate = light == "red" or worse
    reasons = [f"Score {scoring['score']}/100 → {LIGHT_DE[light]}"]
    if worse:
        reasons.append(f"Verschlechterung gegenüber Risikoregister ({LIGHT_DE[register_status]} → {LIGHT_DE[light]})")
    if combos:
        reasons.append(f"{len(combos)} kritische Indikator-Kombination(en)")
    return Decision(
        traffic_light=light,
        escalate=escalate,
        confidence="high" if abs(scoring["score"] - 47) > 20 else "medium",
        justification="; ".join(reasons) + ".",
    )


def decide(master: dict, scoring: dict, combos: list[dict], argumentation: Argumentation, llm: LLM):
    baseline = rule_decision(scoring, master["register_status"], combos)
    try:
        prompt = (
            f"Lieferant: {master['name']}. Internes Risikoregister: {master['register_status']}.\n"
            f"Regelbasierter Score: {scoring['score']}/100 → {scoring['traffic_light']}.\n"
            f"Zusammenfassung: {argumentation.summary}\n"
            "Argumente:\n" + "\n".join(f"- ({a.direction}) {a.title}: {a.reasoning}" for a in argumentation.arguments)
        )
        d = llm.structured(SYSTEM_DECISION, prompt, Decision)
        # Guardrail: the agent may deviate from the rule-based light by at most one level.
        if abs(LIGHTS.index(d.traffic_light) - LIGHTS.index(baseline.traffic_light)) > 1:
            d.traffic_light = "yellow"
            d.justification += " (Begrenzt auf eine Stufe Abweichung vom regelbasierten Score.)"
        if d.traffic_light == "red" or LIGHTS.index(d.traffic_light) > LIGHTS.index(master["register_status"]):
            d.escalate = True
        return d, llm.label
    except LLMUnavailable:
        return baseline, "Regelbasiert"
