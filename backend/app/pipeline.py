"""Orchestrates one quarterly evaluation of a supplier through all modules (Figure 2).

`run` is a generator of progress events so the frontend can show the agents working live.
Generated texts follow `lang` ("de" or "en").
"""

import time
from collections.abc import Iterator
from datetime import datetime, timezone

from . import db
from .config import settings
from .i18n import lang_or_default, t
from .llm import LLM
from .modules import decision_module as dm
from .modules import external_module, internal_module
from .notifiers import Recipient, RiskMessage, dispatch

# Step ids in workflow order; labels and descriptions are translated by the frontend.
STEPS = ["internal", "risk", "external", "mapping", "crossref", "argumentation", "decision", "escalation"]


def _event(step: str, status: str, summary: str = "", **data) -> dict:
    return {"type": "step", "step": step, "status": status, "summary": summary, **data}


def _pause(llm: LLM, pace: bool) -> None:
    if pace and llm.provider == "demo" and settings.demo_step_delay:
        time.sleep(settings.demo_step_delay)


def recipients_for(master: dict) -> tuple[list[Recipient], list[str]]:
    """Everyone to warn about a supplier: its buyer and the contacts of every linked plant.

    Duplicates (same e-mail address) are removed. Returns the recipients and the plant names.
    """
    people: list[Recipient] = []
    buyer = master.get("buyer") or {}
    if buyer.get("name") or buyer.get("email"):
        people.append(Recipient(name=buyer.get("name", ""), email=buyer.get("email", ""), role="buyer"))
    plants = []
    for plant_id in master.get("plant_ids", []):
        plant = db.get_plant(plant_id)
        if not plant:
            continue
        plants.append(plant["name"])
        for c in plant.get("contacts", []):
            people.append(Recipient(name=c.get("name", ""), email=c.get("email", ""), role=c.get("role", ""), plant=plant["name"]))
    seen, unique = set(), []
    for p in people:
        key = (p.email or p.name).strip().lower()
        if key and key not in seen:
            seen.add(key)
            unique.append(p)
    return unique, plants


def run(
    supplier_id: str, llm: LLM | None = None, channels: list[str] | None = None, pace: bool = True, lang: str | None = None
) -> Iterator[dict]:
    """Evaluates one supplier. Escalations are delivered through `channels` (default: cockpit only)."""
    channels = ["inapp"] if channels is None else channels
    lang = lang_or_default(lang)
    llm = llm or LLM()
    master = db.get_supplier(supplier_id)
    if master is None:
        yield {"type": "error", "message": f"Unknown supplier {supplier_id}"}
        return
    yield {"type": "start", "supplier_id": supplier_id, "llm": llm.label, "steps": STEPS}
    yes_no = lambda v: t(lang, "yes" if v else "no")  # noqa: E731

    yield _event("internal", "running")
    _pause(llm, pace)
    internal = internal_module.compute_kpis(db.get_internal(supplier_id), lang)
    flagged = [k for k in internal["kpis"] if k["status"] != "ok"]
    missing = internal["missing_sources"]
    summary = t(lang, "step.internal", n=len(internal["kpis"]), flagged=len(flagged))
    if missing:
        summary += t(lang, "step.internal.missing", sources=", ".join(missing))
    yield _event("internal", "done", summary)

    yield _event("risk", "running")
    check, risk_method = internal_module.risk_check(master, internal["kpis"], llm, lang)
    _pause(llm, pace)
    yield _event("risk", "done", t(lang, "step.risk", answer=yes_no(check.risk), reasoning=check.reasoning, method=risk_method))

    if not check.risk:
        # Figure 2: no risk → "Risk Evaluation next quarter"; the Decision Module is not needed.
        for step in STEPS[2:]:
            yield _event(step, "skipped", t(lang, "step.skipped"))
        report = _report(
            supplier_id, llm, lang, internal, check, risk_method, [], t(lang, "origin.not_evaluated"), [], [],
            dm.Argumentation(summary=check.reasoning, arguments=[], recommendation=t(lang, "rec.none"), measures=[]),
            dm.Decision(escalate=False, confidence="medium", justification=t(lang, "decision.no_risk")),
            [],
        )
        db.save_result(supplier_id, report)
        yield {"type": "result", "report": report}
        return

    yield _event("external", "running")
    docs, origin = external_module.collect(master, db.get_external(supplier_id), lang)
    classified, method = external_module.classify(master, docs, llm, lang)
    _pause(llm, pace)
    n_risk = sum(1 for d in classified if d["signal"] == "risk")
    yield _event("external", "done", t(lang, "step.external", origin=origin, n=n_risk, method=method))

    yield _event("mapping", "running")
    _pause(llm, pace)
    indicators = dm.map_indicators(internal["kpis"], classified, internal["as_of"], lang)
    n = {k: sum(1 for i in indicators if i["type"] == k) for k in ("risk", "success", "neutral")}
    yield _event("mapping", "done", t(lang, "step.mapping", **n))

    yield _event("crossref", "running")
    _pause(llm, pace)
    combos = dm.cross_reference(indicators, lang)
    n_fin = sum(1 for i in indicators if i["type"] == "risk" and i["priority"] == "financial")
    yield _event("crossref", "done", t(lang, "step.crossref", combos=len(combos), fin=n_fin))

    yield _event("argumentation", "running")
    argumentation, arg_method = dm.generate_argumentation(master, indicators, combos, llm, lang)
    _pause(llm, pace)
    yield _event("argumentation", "done", t(lang, "step.argumentation", n=len(argumentation.arguments), method=arg_method))

    yield _event("decision", "running")
    decision, dec_method = dm.decide(master, indicators, combos, argumentation, llm, lang)
    if missing:
        decision.justification += t(lang, "decision.missing", sources=", ".join(missing))
        if len(missing) >= 2:
            decision.confidence = "low"
    _pause(llm, pace)
    yield _event("decision", "done", t(lang, "step.decision", answer=yes_no(decision.escalate), method=dec_method))

    yield _event("escalation", "running")
    deliveries: list[dict] = []
    if decision.escalate and channels:
        recipients, plants = recipients_for(master)
        message = RiskMessage(
            supplier_id=supplier_id,
            supplier_name=master["name"],
            supplier_number=master["number"],
            recipients=recipients,
            plants=plants,
            lang=lang,
            subject=t(lang, "mail.subject", name=master["name"], number=master["number"]),
            summary=argumentation.summary,
            recommendation=argumentation.recommendation,
            measures=argumentation.measures,
            link=f"{settings.app_base_url.rstrip('/')}/?supplier={supplier_id}",
        )
        deliveries = dispatch(message, channels)
        sent = sorted({d["channel"] for d in deliveries if d["status"] == "sent"})
        failed = sorted({d["channel"] for d in deliveries if d["status"] != "sent"})
        summary = t(lang, "step.escalation.sent", recipients=", ".join(r.name or r.email for r in recipients) or "–", channels=", ".join(sent) or "–")
        if failed:
            summary += t(lang, "step.escalation.failed", channels=", ".join(failed))
    else:
        summary = t(lang, "step.escalation.none")
    yield _event("escalation", "done", summary)

    report = _report(
        supplier_id, llm, lang, internal, check, risk_method, classified, origin, indicators, combos, argumentation, decision, deliveries
    )
    db.save_result(supplier_id, report)
    yield {"type": "result", "report": report}


def _report(
    supplier_id, llm, lang, internal, check, risk_method, external, origin, indicators, combos, argumentation, decision, deliveries
) -> dict:
    status = "escalated" if decision.escalate else ("risk" if check.risk else "none")
    return {
        "supplier_id": supplier_id,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "llm": llm.label,
        "lang": lang,
        "as_of": internal["as_of"],
        "status": status,
        "kpis": internal["kpis"],
        "forecast": internal["forecast"],
        "series": internal["series"],
        "risk_check": {**check.model_dump(), "method": risk_method},
        "external": external,
        "external_origin": origin,
        "indicators": indicators,
        "combinations": combos,
        "argumentation": argumentation.model_dump(),
        "decision": decision.model_dump(),
        "missing_sources": internal["missing_sources"],
        "deliveries": deliveries,
    }


def run_to_completion(
    supplier_id: str, llm: LLM | None = None, channels: list[str] | None = None, lang: str | None = None
) -> dict:
    report = None
    for event in run(supplier_id, llm, channels, pace=False, lang=lang):
        if event["type"] == "result":
            report = event["report"]
    return report
