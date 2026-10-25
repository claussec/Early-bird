"""Decision Module (Figure 4).

A preset task list guides the AI agent through the steps in sequence, so that the data
is first structured, then validated, and finally weighed against each other:
  1. Mapping indicators   – every data point becomes a risk or success indicator (standardized matrix)
  2. Cross-referencing     – indicators are relativized and weighed, financial signals prioritized
  3. Argumentation         – a traceable chain of argumentation
  4. AI decision making    – "Escalation?" with an action-oriented recommendation
The escalation itself (notification to the buyer) is handled by the pipeline.

Following the paper there is no numeric score: the result is the argumentation and the
escalation decision, which the buyer uses for the final risk assessment.
"""

from datetime import date
from typing import Literal

from pydantic import BaseModel

from ..llm import LLM, LLMUnavailable

# Financial signals are prioritized over quality signals (paper, "Interpretation of results").
FINANCIAL_GROUPS = ("Rating", "Umsatz", "Abhängigkeit", "Planung")
PRIORITY = {"finanziell": 0, "extern": 1, "operativ": 2}
LIGHT_DE = {"green": "Grün", "yellow": "Gelb", "red": "Rot"}
STRENGTH_DE = {"strong": "deutlich", "weak": "schwach"}
# Web signals older than this count as weak (relativizing by recency).
EXTERNAL_MAX_AGE_YEARS = 2


# --- Step 1: Mapping indicators (standardized matrix) ------------------------------------


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
    """Assigns every data point to a risk, success or neutral indicator.

    KPI threshold exceeded → risk indicator ("deutlich" above the critical threshold,
    "schwach" above the warning threshold); clearly positive value → success indicator.
    """
    indicators = []
    for k in kpis:
        if k["status"] in ("critical", "warn"):
            kind, strength = "risk", "strong" if k["status"] == "critical" else "weak"
        elif _success(k):
            kind, strength = "success", "weak"
        else:
            kind, strength = "neutral", None
        indicators.append(
            {
                "id": k["id"],
                "label": k["label"],
                "group": k["group"],
                "type": kind,
                "strength": strength,
                "priority": "finanziell" if k["group"] in FINANCIAL_GROUPS else "operativ",
                "value": f"{k['value']} {k['unit']}",
                "source": k["source"],
                "evidence": f"{k['formula']} (Schwelle: {k['threshold']})",
            }
        )
    ref_year = int(as_of[:4]) if as_of else date.today().year
    for i, doc in enumerate(external):
        if doc["signal"] == "neutral":
            continue
        age = max(0, ref_year - int(doc["date"][:4])) if doc.get("date") else None
        strength = "strong" if doc["severity"] == 3 else "weak"
        note = ""
        if age is not None and age >= EXTERNAL_MAX_AGE_YEARS:
            strength, note = "weak", f" Meldung ist {age} Jahre alt und wird daher schwächer gewichtet."
        indicators.append(
            {
                "id": f"ext_{i}",
                "label": doc["title"],
                "group": "Extern",
                "category": doc["category"],
                "type": doc["signal"],
                "strength": strength,
                "severity": doc["severity"],
                "priority": "extern",
                "value": doc["category"],
                "source": doc.get("source", "Web"),
                "evidence": doc["rationale"] + note,
                "date": doc.get("date", ""),
                "url": doc.get("url", ""),
            }
        )
    return indicators


# --- Step 2: Cross-referencing ----------------------------------------------------------


def prioritized(indicators: list[dict], kind: str) -> list[dict]:
    """Indicators of one type, financial before external before operational, strong before weak."""
    return sorted(
        (i for i in indicators if i["type"] == kind),
        key=lambda i: (PRIORITY[i["priority"]], 0 if i["strength"] == "strong" else 1),
    )


def cross_reference(indicators: list[dict]) -> list[dict]:
    """Relates indicators to each other; each combination is an argument of its own."""
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
    # Web signals with at least a clear warning (severity 2 of 3).
    severe_ext = [i for i in ext_risk if i.get("severity", 1) >= 2]
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
    escalate: bool
    confidence: Literal["low", "medium", "high"]
    justification: str


SYSTEM_ARGUMENT = (
    "Du bist der AI Agent 'Decision Maker' eines Frühwarnsystems für finanziell kritische Lieferanten im "
    "Automotive-Einkauf. Du erhältst strukturierte Risiko- und Erfolgsindikatoren (mit Werten, Schwellen und "
    "Quellen) sowie Kombinationen aus dem Cross-Referencing. Relativiere und gewichte die Indikatoren "
    "gegeneinander, priorisiere Finanzsignale vor Qualitätssignalen und erzeuge eine nachvollziehbare "
    "Argumentationskette für den verantwortlichen Einkäufer: Jedes Argument muss sich auf konkrete "
    "indicator_ids stützen. Berücksichtige auch stabilisierende Erfolgsindikatoren. Erfinde keine Zahlen; "
    "verwende nur die gelieferten Werte. Vergib keine Punkte und keinen Score. Schreibe sachlich auf Deutsch. "
    "Gib eine handlungsorientierte Empfehlung (z. B. sorgfältige Neubewertung, Phase-out prüfen, beobachten) "
    "und 2–5 konkrete Maßnahmen."
)

SYSTEM_DECISION = (
    "Du bist der AI Agent 'Decision Maker'. Entscheide auf Basis der Argumentationskette, ob der Fall an den "
    "verantwortlichen Einkäufer eskaliert wird (Escalation? ja/nein). Eskaliere, wenn die Argumente auf ein "
    "relevantes finanzielles Risiko hindeuten, das Handeln des Einkäufers erfordert. Reine Qualitätsauffälligkeiten "
    "ohne finanzielle Signale sind kein Grund für eine Eskalation. Begründe die Entscheidung mit den "
    "ausschlaggebenden Argumenten und vergib keinen Score."
)


def _fmt_indicators(indicators: list[dict]) -> str:
    return "\n".join(
        f"- {i['id']} [{i['group']}, {i['type']}, {STRENGTH_DE.get(i['strength'], '')}, Priorität {i['priority']}]: "
        f"{i['label']} = {i['value']} (Quelle: {i['source']}; {i['evidence']})"
        for i in prioritized(indicators, "risk") + prioritized(indicators, "success")
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


def escalation_triggers(indicators: list[dict], combos: list[dict]) -> list[str]:
    """Transparent rule for the escalation decision without an LLM.

    Escalate when the cross-referencing found at least one combination, or when at least one
    financial (or financially relevant external) risk indicator is clearly above its threshold.
    Quality indicators alone never escalate, because financial signals are prioritized.
    """
    triggers = [f"Kombination „{c['title']}“" for c in combos]
    for i in prioritized(indicators, "risk"):
        if i["strength"] == "strong" and i["priority"] in ("finanziell", "extern"):
            triggers.append(f"{i['label']} ({i['value']})" if i["priority"] == "finanziell" else f"Web-Meldung: {i['label']}")
    return triggers


def template_argumentation(indicators: list[dict], combos: list[dict]) -> Argumentation:
    args, covered = [], set()
    for c in combos:
        args.append(
            Argument(title=c["title"], direction="risk", reasoning=c["description"], indicator_ids=c["indicator_ids"])
        )
        covered.update(c["indicator_ids"])
    risks = prioritized(indicators, "risk")
    for i in risks:
        if i["id"] in covered or len(args) >= 6:
            continue
        args.append(
            Argument(
                title=i["label"],
                direction="risk",
                reasoning=f"{i['label']}: {i['value']}, Risikoindikator ({STRENGTH_DE[i['strength']]}). "
                f"{i['evidence']} (Quelle: {i['source']}).",
                indicator_ids=[i["id"]],
            )
        )
    for i in prioritized(indicators, "success")[:3]:
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
    financial = [i for i in risks if i["priority"] == "finanziell"]
    if escalation_triggers(indicators, combos):
        if any(c["id"] == "dependency_decline" for c in combos) or len([i for i in financial if i["strength"] == "strong"]) >= 3:
            rec = (
                "Sorgfältige Neubewertung des Lieferanten durch den Einkäufer; Phase-out bzw. Dual-Sourcing prüfen "
                "und das zentrale Risikomanagement einbinden."
            )
        else:
            rec = "Sorgfältige Neubewertung des Lieferanten: Lieferantengespräch führen und aktuelle Finanzunterlagen anfordern."
    else:
        rec = "Auffälligkeiten beobachten und im nächsten Quartal erneut bewerten."
        measures = measures[:2]
    top = ", ".join(i["label"] for i in risks[:3]) or "keine"
    summary = (
        f"{len(risks)} Risikoindikator(en), davon {len(financial)} finanziell, und {len(combos)} kritische "
        f"Kombination(en). Wichtigste Treiber: {top}."
    )
    if not measures:
        measures = ["Entwicklung im nächsten Quartal erneut bewerten"]
    return Argumentation(summary=summary, arguments=args, recommendation=rec, measures=measures[:5])


def generate_argumentation(master: dict, indicators: list[dict], combos: list[dict], llm: LLM):
    try:
        prompt = (
            f"Lieferant: {master['name']} ({master['commodity']}), internes Risikoregister: "
            f"{LIGHT_DE[master['register_status']]}.\n\n"
            f"Indikatoren (priorisiert):\n{_fmt_indicators(indicators)}\n\n"
            "Kombinationen:\n"
            + ("\n".join(f"- {c['title']}: {c['description']} ({', '.join(c['indicator_ids'])})" for c in combos) or "(keine)")
        )
        return llm.structured(SYSTEM_ARGUMENT, prompt, Argumentation), llm.label
    except LLMUnavailable:
        return template_argumentation(indicators, combos), "Regelbasierte Vorlage"


# --- Step 4: AI decision making -----------------------------------------------------------


def rule_decision(indicators: list[dict], combos: list[dict], register_status: str) -> Decision:
    triggers = escalation_triggers(indicators, combos)
    if triggers:
        text = "Eskalation, ausschlaggebend: " + "; ".join(triggers[:4]) + "."
        if register_status == "red":
            text += " Der Lieferant ist im internen Risikoregister bereits als Risikolieferant geführt."
    else:
        text = (
            "Keine Eskalation: Kein finanzieller Indikator liegt deutlich über seiner Schwelle und das "
            "Cross-Referencing hat keine kritische Kombination ergeben."
        )
    return Decision(escalate=bool(triggers), confidence="medium", justification=text)


def decide(master: dict, indicators: list[dict], combos: list[dict], argumentation: Argumentation, llm: LLM):
    try:
        prompt = (
            f"Lieferant: {master['name']}. Internes Risikoregister: {LIGHT_DE[master['register_status']]}.\n"
            f"Zusammenfassung: {argumentation.summary}\n"
            "Argumente:\n" + "\n".join(f"- ({a.direction}) {a.title}: {a.reasoning}" for a in argumentation.arguments)
            + f"\nEmpfehlung: {argumentation.recommendation}"
        )
        return llm.structured(SYSTEM_DECISION, prompt, Decision), llm.label
    except LLMUnavailable:
        return rule_decision(indicators, combos, master["register_status"]), "Regelbasiert"
