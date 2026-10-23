"""Auto mode: periodically evaluates every stored supplier number and notifies the buyers.

For each supplier the run
  1. refreshes master and internal data from the supplier's source system (if connected),
  2. runs the full agent pipeline,
  3. delivers escalations through the configured channels (Outlook, Teams, cockpit).

Settings are stored in the database and can be changed at runtime via /api/automode.
"""

import asyncio
import logging
import threading
from datetime import datetime, timedelta, timezone

from . import db, pipeline
from .config import settings
from .connectors import ConnectorError, get_connector
from .llm import LLM

log = logging.getLogger(__name__)
KEY = "automode"
CHECK_EVERY_SECONDS = 30
_lock = threading.Lock()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def get_state() -> dict:
    state = db.get_setting(KEY)
    if state is None:
        state = {
            "enabled": settings.automode_enabled,
            "interval_minutes": settings.automode_interval_minutes,
            "channels": settings.automode_channels,
            "last_run": None,
            "next_run": None,
            "last_result": None,
        }
    state["running"] = _lock.locked()
    return state


def update_state(**changes) -> dict:
    state = get_state()
    state.update({k: v for k, v in changes.items() if v is not None})
    if changes.get("enabled") and not state.get("next_run"):
        state["next_run"] = _now().isoformat(timespec="seconds")
    if "interval_minutes" in changes and state.get("last_run"):
        last = datetime.fromisoformat(state["last_run"])
        state["next_run"] = (last + timedelta(minutes=state["interval_minutes"])).isoformat(timespec="seconds")
    state.pop("running", None)
    db.set_setting(KEY, state)
    return get_state()


def refresh_from_source(master: dict) -> str | None:
    """Pulls current data from the supplier's source system. Returns a note on failure."""
    connector = get_connector(master.get("source", ""))
    if connector is None or connector.id == "local":
        return None
    try:
        record = connector.get_master(master["number"])
        if record is None:
            return f"{master['number']} in {connector.name} nicht gefunden"
        updated = {**master, "name": record.name or master["name"]}
        for field in ("city", "country", "website", "commodity"):
            if getattr(record, field):
                updated[field] = getattr(record, field)
        db.upsert_master(updated)
        data = connector.get_internal_data(master["number"])
        if data:
            db.save_internal(master["id"], data)
    except NotImplementedError as e:
        return str(e)
    except ConnectorError as e:
        return f"{connector.name}: {e}"
    return None


def run_once(llm: LLM | None = None) -> dict:
    """Runs one full cycle. Returns a summary; concurrent calls are rejected."""
    if not _lock.acquire(blocking=False):
        return {"skipped": "Ein Lauf ist bereits aktiv"}
    try:
        state = get_state()
        channels = ["inapp", *[c for c in state["channels"] if c != "inapp"]]
        started = _now()
        llm = llm or LLM()
        summary = {"started": started.isoformat(timespec="seconds"), "suppliers": 0, "escalations": 0,
                   "sent": 0, "failed": 0, "source_notes": []}
        for master in db.list_suppliers():
            note = refresh_from_source(master)
            if note:
                summary["source_notes"].append(note)
            report = pipeline.run_to_completion(master["id"], llm, channels)
            summary["suppliers"] += 1
            if report["decision"]["escalate"]:
                summary["escalations"] += 1
            for d in report["deliveries"]:
                if d["channel"] != "inapp":
                    summary["sent" if d["status"] == "sent" else "failed"] += 1
        finished = _now()
        summary["finished"] = finished.isoformat(timespec="seconds")
        update_state(
            last_run=finished.isoformat(timespec="seconds"),
            next_run=(finished + timedelta(minutes=state["interval_minutes"])).isoformat(timespec="seconds"),
            last_result=summary,
        )
        return summary
    finally:
        _lock.release()


async def scheduler() -> None:
    """Background loop started with the API server."""
    while True:
        try:
            state = get_state()
            due = state.get("next_run") and _now() >= datetime.fromisoformat(state["next_run"])
            if state["enabled"] and (due or not state.get("next_run")) and not state["running"]:
                log.info("Automode: starting cycle")
                await asyncio.to_thread(run_once)
        except Exception:  # keep the scheduler alive; the error is logged
            log.exception("Automode cycle failed")
        await asyncio.sleep(CHECK_EVERY_SECONDS)
