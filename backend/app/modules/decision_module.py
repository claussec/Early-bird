"""Decision Module (Figure 4).

A preset task list guides the AI agent through the steps in sequence, so that the data
is first structured, then validated, and finally weighed against each other:
  1. Mapping indicators   – every data point becomes a risk or success indicator (standardized matrix)
  2. Cross-referencing     – indicators are relativized and weighed, financial signals prioritized
  3. Argumentation         – a traceable chain of argumentation
  4. AI decision making    – "Escalation?" with an action-oriented recommendation
The escalation itself (notification of the buyer and plant contacts) is handled by the pipeline.

Following the paper there is no numeric score: the result is the argumentation and the
escalation decision, which the buyer uses for the final risk assessment.
"""

from datetime import date
from typing import Literal

from pydantic import BaseModel

from ..i18n import t
from ..llm import LLM, LLMUnavailable

# Financial signals are prioritized over quality signals (paper, "Interpretation of results").
FINANCIAL_GROUPS = ("rating", "revenue", "dependency", "planning")
PRIORITY = {"financial": 0, "external": 1, "operational": 2}
LIGHT_NAMES = {"de": {"green": "Grün", "yellow": "Gelb", "red": "Rot"}, "en": {"green": "green", "yellow": "yellow", "red": "red"}}
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


def map_indicators(kpis: list[dict], external: list[dict], as_of: str, lang: str = "de") -> list[dict]:
    """Assigns every data point to a risk, success or neutral indicator.

    KPI threshold exceeded → risk indicator ("strong" above the critical threshold,
    "weak" above the warning threshold); clearly positive value → success indicator.
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
                "priority": "financial" if k["group"] in FINANCIAL_GROUPS else "operational",
                "value": f"{k['value']} {k['unit']}",
                "source": k["source"],
                "evidence": t(lang, "ind.threshold", formula=k["formula"], threshold=k["threshold"]),
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
            strength, note = "weak", t(lang, "ind.old_signal", age=age)
        indicators.append(
            {
                "id": f"ext_{i}",
                "label": doc["title"],
                "group": "external",
                "category": doc["category"],
                "type": doc["signal"],
                "strength": strength,
                "severity": doc["severity"],
                "priority": "external",
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


def _combo(cid: str, ids: list[str], lang: str) -> dict:
    return {"id": cid, "title": t(lang, f"combo.{cid}"), "description": t(lang, f"combo.{cid}.desc"), "indicator_ids": ids}


def cross_reference(indicators: list[dict], lang: str = "de") -> list[dict]:
    """Relates indicators to each other; each combination is an argument of its own."""
    by_id = {i["id"]: i for i in indicators}

    def risk(i: str) -> bool:
        return i in by_id and by_id[i]["type"] == "risk"

    ext_risk = [i for i in indicators if i["group"] == "external" and i["type"] == "risk"]
    internal_fin_risk = [i for i in indicators if i["group"] in ("rating", "revenue") and i["type"] == "risk"]
    combos = []
    if risk("customer_share") and (risk("revenue_forecast") or risk("plan_change")):
        ids = [x for x in ("customer_share", "revenue_forecast", "plan_change") if risk(x)]
        combos.append(_combo("dependency_decline", ids, lang))
    if (risk("pd_trend") or risk("pd_latest")) and risk("plan_volatility"):
        combos.append(_combo("rating_planning", [x for x in ("pd_latest", "pd_trend", "plan_volatility") if risk(x)], lang))
    if risk("rating_gap") and risk("pd_trend"):
        combos.append(_combo("rating_lag", ["rating_gap", "pd_trend"], lang))
    if ext_risk and internal_fin_risk:
        ids = [i["id"] for i in ext_risk[:3]] + [i["id"] for i in internal_fin_risk[:2]]
        combos.append(_combo("external_confirms", ids, lang))
    # Web signals with at least a clear warning (severity 2 of 3).
    severe_ext = [i for i in ext_risk if i.get("severity", 1) >= 2]
    if len(severe_ext) >= 2 and not internal_fin_risk:
        combos.append(_combo("divergence", [i["id"] for i in severe_ext[:3]], lang))
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
    "You are the AI agent 'Decision Maker' of an early-warning system for financially critical suppliers in "
    "automotive purchasing. You receive structured risk and success indicators (with values, thresholds and "
    "sources) and combinations from the cross-referencing. Relativize and weigh the indicators against each "
    "other, prioritize financial over quality signals and build a traceable chain of argumentation for the "
    "responsible buyer: every argument must rest on specific indicator_ids. Also consider stabilizing success "
    "indicators. Do not invent figures; use only the values provided. Do not assign points or a score. Write "
    "factually. Give an action-oriented recommendation (e.g. careful re-evaluation, examine a phase-out, monitor) "
    "and 2–5 concrete measures."
)

SYSTEM_DECISION = (
    "You are the AI agent 'Decision Maker'. Based on the chain of argumentation, decide whether the case is "
    "escalated to the responsible buyer and the affected plant contacts (Escalation? yes/no). Escalate when the "
    "arguments point to a relevant financial risk that requires the buyer to act. Quality anomalies without "
    "financial signals are no reason to escalate. Justify the decision with the decisive arguments and do not "
    "assign a score."
)


def _fmt_indicators(indicators: list[dict], lang: str) -> str:
    return "\n".join(
        f"- {i['id']} [{i['group']}, {i['type']}, {t(lang, 'strength.' + i['strength']) if i['strength'] else ''}, "
        f"priority {i['priority']}]: {i['label']} = {i['value']} ({i['source']}; {i['evidence']})"
        for i in prioritized(indicators, "risk") + prioritized(indicators, "success")
    )


MEASURES = {
    "customer_share": "measure.customer_share",
    "pd_latest": "measure.financials",
    "pd_trend": "measure.financials",
    "plan_volatility": "measure.plan_volatility",
    "revenue_forecast": "measure.revenue_forecast",
    "plan_change": "measure.plan_change",
    "external": "measure.external",
    "ppm": "measure.ppm",
    "otd": "measure.otd",
}


def escalation_triggers(indicators: list[dict], combos: list[dict], lang: str = "de") -> list[str]:
    """Transparent rule for the escalation decision without an LLM.

    Escalate when the cross-referencing found at least one combination, or when at least one
    financial (or financially relevant external) risk indicator is clearly above its threshold.
    Quality indicators alone never escalate, because financial signals are prioritized.
    """
    triggers = [t(lang, "trigger.combo", title=c["title"]) for c in combos]
    for i in prioritized(indicators, "risk"):
        if i["strength"] == "strong" and i["priority"] in ("financial", "external"):
            triggers.append(f"{i['label']} ({i['value']})" if i["priority"] == "financial" else t(lang, "trigger.web", label=i["label"]))
    return triggers


def template_argumentation(indicators: list[dict], combos: list[dict], lang: str = "de") -> Argumentation:
    args, covered = [], set()
    for c in combos:
        args.append(Argument(title=c["title"], direction="risk", reasoning=c["description"], indicator_ids=c["indicator_ids"]))
        covered.update(c["indicator_ids"])
    risks = prioritized(indicators, "risk")
    for i in risks:
        if i["id"] in covered or len(args) >= 6:
            continue
        reasoning = t(
            lang, "ind.risk_reasoning", label=i["label"], value=i["value"], strength=t(lang, "strength." + i["strength"]),
            evidence=i["evidence"], source=i["source"],
        )
        args.append(Argument(title=i["label"], direction="risk", reasoning=reasoning, indicator_ids=[i["id"]]))
    for i in prioritized(indicators, "success")[:3]:
        args.append(
            Argument(
                title=t(lang, "ind.stabilizing", label=i["label"]),
                direction="success",
                reasoning=t(lang, "ind.success_reasoning", label=i["label"], value=i["value"], evidence=i["evidence"]),
                indicator_ids=[i["id"]],
            )
        )
    measures: list[str] = []
    for i in risks:
        key = MEASURES.get(i["id"]) or MEASURES.get(i["group"])
        if key and t(lang, key) not in measures:
            measures.append(t(lang, key))
    financial = [i for i in risks if i["priority"] == "financial"]
    if escalation_triggers(indicators, combos, lang):
        strong_fin = [i for i in financial if i["strength"] == "strong"]
        rec = t(lang, "rec.phase_out") if any(c["id"] == "dependency_decline" for c in combos) or len(strong_fin) >= 3 else t(lang, "rec.reevaluate")
    else:
        rec = t(lang, "rec.observe")
        measures = measures[:2]
    top = ", ".join(i["label"] for i in risks[:3]) or t(lang, "summary.none")
    summary = t(lang, "summary", n_risk=len(risks), n_fin=len(financial), n_combo=len(combos), top=top)
    if not measures:
        measures = [t(lang, "measure.next_quarter")]
    return Argumentation(summary=summary, arguments=args, recommendation=rec, measures=measures[:5])


def generate_argumentation(master: dict, indicators: list[dict], combos: list[dict], llm: LLM, lang: str = "de"):
    try:
        register = LIGHT_NAMES[lang][master["register_status"]]
        prompt = (
            f"{t(lang, 'language')}\n\nSupplier: {master['name']} ({master['commodity']}), internal risk register: {register}.\n\n"
            f"Indicators (prioritized):\n{_fmt_indicators(indicators, lang)}\n\n"
            "Combinations:\n"
            + ("\n".join(f"- {c['title']}: {c['description']} ({', '.join(c['indicator_ids'])})" for c in combos) or "(none)")
        )
        return llm.structured(SYSTEM_ARGUMENT, prompt, Argumentation), llm.label
    except LLMUnavailable:
        return template_argumentation(indicators, combos, lang), t(lang, "method.template")


# --- Step 4: AI decision making -----------------------------------------------------------


def rule_decision(indicators: list[dict], combos: list[dict], register_status: str, lang: str = "de") -> Decision:
    triggers = escalation_triggers(indicators, combos, lang)
    if triggers:
        text = t(lang, "decision.escalate", triggers="; ".join(triggers[:4]))
        if register_status == "red":
            text += t(lang, "decision.register_red")
    else:
        text = t(lang, "decision.no_escalation")
    return Decision(escalate=bool(triggers), confidence="medium", justification=text)


def decide(master: dict, indicators: list[dict], combos: list[dict], argumentation: Argumentation, llm: LLM, lang: str = "de"):
    try:
        register = LIGHT_NAMES[lang][master["register_status"]]
        prompt = (
            f"{t(lang, 'language')}\n\nSupplier: {master['name']}. Internal risk register: {register}.\n"
            f"Summary: {argumentation.summary}\n"
            "Arguments:\n" + "\n".join(f"- ({a.direction}) {a.title}: {a.reasoning}" for a in argumentation.arguments)
            + f"\nRecommendation: {argumentation.recommendation}"
        )
        return llm.structured(SYSTEM_DECISION, prompt, Decision), llm.label
    except LLMUnavailable:
        return rule_decision(indicators, combos, master["register_status"], lang), t(lang, "method.rules")
