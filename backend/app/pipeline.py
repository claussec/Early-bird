"""Orchestrates one quarterly evaluation of a supplier through all modules (Figure 2).

`run` is a generator of progress events so the frontend can show the agents working live.
"""

import time
from collections.abc import Iterator
from datetime import datetime, timezone

from . import db
from .config import settings
from .llm import LLM
from .modules import decision_module as dm
from .modules import external_module, internal_module
from .notifiers import RiskMessage, dispatch

STEPS = [
    ("internal", "Internal Module", "Interne Daten sammeln & KPIs berechnen"),
    ("external", "External Module", "Web-Crawling & Klassifikation"),
    ("mapping", "Mapping Indicators", "Datenpunkte → Risiko-/Erfolgsindikatoren"),
    ("crossref", "Cross-Referencing", "Indikatoren relativieren & kombinieren"),
    ("argumentation", "Argumentation Generation", "Nachvollziehbare Argumentationskette"),
    ("decision", "AI Decision Making", "Ampel & Eskalationsentscheidung"),
    ("escalation", "Escalation", "Benachrichtigung des Einkäufers"),
]


def _event(step: str, status: str, summary: str = "", **data) -> dict:
    return {"type": "step", "step": step, "status": status, "summary": summary, **data}


def _pause(llm: LLM, pace: bool) -> None:
    if pace and llm.provider == "demo" and settings.demo_step_delay:
        time.sleep(settings.demo_step_delay)


def run(
    supplier_id: str, llm: LLM | None = None, channels: list[str] | None = None, pace: bool = True
) -> Iterator[dict]:
    """Evaluates one supplier. Escalations are delivered through `channels` (default: cockpit only)."""
    channels = ["inapp"] if channels is None else channels
    llm = llm or LLM()
    master = db.get_supplier(supplier_id)
    if master is None:
        yield {"type": "error", "message": f"Unbekannter Lieferant {supplier_id}"}
        return
    yield {"type": "start", "supplier_id": supplier_id, "llm": llm.label, "steps": STEPS}

    yield _event("internal", "running")
    _pause(llm, pace)
    internal = internal_module.compute_kpis(db.get_internal(supplier_id))
    flagged = [k for k in internal["kpis"] if k["status"] != "ok"]
    missing = internal["missing_sources"]
    yield _event(
        "internal",
        "done",
        f"{len(internal['kpis'])} KPIs berechnet, {len(flagged)} auffällig"
        + (f". Keine Daten aus: {', '.join(missing)}" if missing else ""),
    )

    yield _event("external", "running")
    docs, origin = external_module.collect(master, db.get_external(supplier_id))
    classified, method = external_module.classify(master, docs, llm)
    _pause(llm, pace)
    n_risk = sum(1 for d in classified if d["signal"] == "risk")
    yield _event("external", "done", f"{origin}. {n_risk} Risikosignal(e). Klassifikation: {method}")

    yield _event("mapping", "running")
    _pause(llm, pace)
    indicators = dm.map_indicators(internal["kpis"], classified, internal["as_of"])
    n = {t: sum(1 for i in indicators if i["type"] == t) for t in ("risk", "success", "neutral")}
    yield _event("mapping", "done", f"{n['risk']} Risiko-, {n['success']} Erfolgs-, {n['neutral']} neutrale Indikatoren")

    yield _event("crossref", "running")
    _pause(llm, pace)
    combos = dm.cross_reference(indicators)
    scoring = dm.score(indicators, combos)
    yield _event(
        "crossref", "done",
        f"{len(combos)} kritische Kombination(en), Score {scoring['score']}/100",
    )

    yield _event("argumentation", "running")
    argumentation, arg_method = dm.generate_argumentation(master, indicators, combos, scoring, llm)
    _pause(llm, pace)
    yield _event("argumentation", "done", f"{len(argumentation.arguments)} Argumente ({arg_method})")

    yield _event("decision", "running")
    decision, dec_method = dm.decide(master, scoring, combos, argumentation, llm)
    if missing:
        decision.justification += f" Datenlage unvollständig – fehlend: {', '.join(missing)}."
        if len(missing) >= 2:
            decision.confidence = "low"
    _pause(llm, pace)
    yield _event(
        "decision", "done",
        f"Ampel {dm.LIGHT_DE[decision.traffic_light]}, Eskalation: {'ja' if decision.escalate else 'nein'} ({dec_method})",
    )

    yield _event("escalation", "running")
    deliveries: list[dict] = []
    if decision.escalate and channels:
        buyer = master["buyer"]
        message = RiskMessage(
            supplier_id=supplier_id,
            supplier_name=master["name"],
            supplier_number=master["number"],
            recipient_name=buyer["name"],
            recipient_email=buyer["email"],
            traffic_light=decision.traffic_light,
            score=scoring["score"],
            subject=f"[Frühwarnung {dm.LIGHT_DE[decision.traffic_light]}] {master['name']} ({master['number']})",
            summary=argumentation.summary,
            recommendation=argumentation.recommendation,
            measures=argumentation.measures,
            link=f"{settings.app_base_url.rstrip('/')}/?supplier={supplier_id}",
        )
        deliveries = dispatch(message, channels)
    if deliveries:
        sent = [d["channel"] for d in deliveries if d["status"] == "sent"]
        failed = [d["channel"] for d in deliveries if d["status"] != "sent"]
        summary = f"Einkäufer {master['buyer']['name']} benachrichtigt über: {', '.join(sent) or '–'}"
        if failed:
            summary += f" · fehlgeschlagen: {', '.join(failed)}"
    else:
        summary = "Keine Eskalation – Ergebnis gespeichert"
    yield _event("escalation", "done", summary)

    report = {
        "supplier_id": supplier_id,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "llm": llm.label,
        "as_of": internal["as_of"],
        "kpis": internal["kpis"],
        "forecast": internal["forecast"],
        "series": internal["series"],
        "external": classified,
        "external_origin": origin,
        "indicators": indicators,
        "combinations": combos,
        "scoring": scoring,
        "argumentation": argumentation.model_dump(),
        "decision": decision.model_dump(),
        "missing_sources": missing,
        "deliveries": deliveries,
    }
    db.save_result(supplier_id, report)
    yield {"type": "result", "report": report}


def run_to_completion(supplier_id: str, llm: LLM | None = None, channels: list[str] | None = None) -> dict:
    report = None
    for event in run(supplier_id, llm, channels, pace=False):
        if event["type"] == "result":
            report = event["report"]
    return report
