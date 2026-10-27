import asyncio
import contextlib
import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import automode, db, geo, pipeline, seed
from .config import settings
from .connectors import ConnectorError, all_connectors, get_connector, search_all
from .llm import LLM
from .modules.internal_module import THRESHOLDS
from .notifiers import all_notifiers
from .schemas import AutomodeUpdate, ImportRequest, PlantIn, SupplierIn

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init_db()
    if db.is_empty() and settings.seed_demo_data:
        seed.seed()
        # Initial assessment with the rule-based agents so the cockpit is populated
        # without spending LLM tokens; real runs are triggered from the UI or the auto mode.
        bootstrap = LLM("demo")
        for s in db.list_suppliers():
            pipeline.run_to_completion(s["id"], bootstrap)
    task = asyncio.create_task(automode.scheduler())
    yield
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


app = FastAPI(title="Supplier Risk Early Warning", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _summary(master: dict, report: dict | None) -> dict:
    out = {**master}
    if report:
        kpi = {k["id"]: k for k in report["kpis"]}
        series = report["series"]
        out.update(
            status=report["status"],
            escalate=report["decision"]["escalate"],
            risk_indicators=sum(1 for i in report["indicators"] if i["type"] == "risk"),
            recommendation=report["argumentation"]["recommendation"],
            assessed_at=report["created_at"],
            as_of=report["as_of"],
            customer_share=kpi.get("customer_share", {}).get("value"),
            pd=kpi.get("pd_latest", {}).get("value"),
            revenue_forecast=kpi.get("revenue_forecast", {}).get("value"),
            purchase_volume=series["purchase"][-1] if series["purchase"] else None,
            revenue=series["revenue"][-1] if series["revenue"] else None,
            external_risks=sum(1 for d in report["external"] if d["signal"] == "risk"),
            missing_sources=report.get("missing_sources", []),
            headline=report["argumentation"]["summary"],
        )
    return out


def _sse(events) -> StreamingResponse:
    def gen():
        for e in events:
            yield f"data: {json.dumps(e, ensure_ascii=False)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


def _require_supplier(supplier_id: str) -> dict:
    master = db.get_supplier(supplier_id)
    if not master:
        raise HTTPException(404, "Lieferant nicht gefunden")
    return master


def _check_plants(plant_ids: list[str]) -> list[str]:
    unknown = [p for p in plant_ids if db.get_plant(p) is None]
    if unknown:
        raise HTTPException(400, f"Unbekanntes Werk: {', '.join(unknown)}")
    return list(dict.fromkeys(plant_ids))


def _master_from_input(supplier_id: str, body: SupplierIn) -> dict:
    master = {
        "id": supplier_id,
        "number": body.number,
        "name": body.name,
        "street": body.street,
        "zip": body.zip,
        "city": body.city,
        "country": body.country,
        "website": body.website,
        "commodity": body.commodity,
        "buyer": {"name": body.buyer_name, "email": str(body.buyer_email or "")},
        "register_status": body.register_status,
        "source": body.source,
        "plant_ids": _check_plants(body.plant_ids),
    }
    master["location"] = geo.locate(master, body.lat, body.lon)
    return master


def _plant_from_input(plant_id: str, body: PlantIn) -> dict:
    plant = {
        "id": plant_id,
        "name": body.name,
        "street": body.street,
        "zip": body.zip,
        "city": body.city,
        "country": body.country,
        "contacts": [{"name": c.name, "email": str(c.email or ""), "role": c.role} for c in body.contacts],
    }
    plant["location"] = geo.locate(plant, body.lat, body.lon)
    return plant


def _plant_summary(plant: dict) -> dict:
    linked = [s["id"] for s in db.list_suppliers() if plant["id"] in s.get("plant_ids", [])]
    return {**plant, "supplier_ids": linked}


# --- Meta ------------------------------------------------------------------------------


@app.get("/api/meta")
def meta():
    suppliers = db.list_suppliers()
    return {
        "llm": LLM().label,
        "provider": settings.llm_provider,
        "crawler_enabled": settings.crawler_enabled,
        "commodities": sorted({s["commodity"] for s in suppliers}),
        "countries": sorted({s["country"] for s in suppliers if s["country"]}),
        "thresholds": THRESHOLDS,
        "steps": pipeline.STEPS,
        "default_lang": settings.default_lang,
    }


# --- Plants of the buying organization ---------------------------------------------------


@app.get("/api/plants")
def plants():
    return [_plant_summary(p) for p in db.list_plants()]


@app.post("/api/plants", status_code=201)
def create_plant(body: PlantIn):
    plant = _plant_from_input(db.next_plant_id(), body)
    db.upsert_plant(plant)
    return _plant_summary(plant)


@app.put("/api/plants/{plant_id}")
def update_plant(plant_id: str, body: PlantIn):
    if not db.get_plant(plant_id):
        raise HTTPException(404, "Werk nicht gefunden")
    plant = _plant_from_input(plant_id, body)
    db.upsert_plant(plant)
    return _plant_summary(plant)


@app.delete("/api/plants/{plant_id}", status_code=204)
def delete_plant(plant_id: str):
    if not db.get_plant(plant_id):
        raise HTTPException(404, "Werk nicht gefunden")
    db.delete_plant(plant_id)


# --- Suppliers -------------------------------------------------------------------------


@app.get("/api/suppliers")
def suppliers(q: str = ""):
    """All suppliers with their latest assessment; `q` filters by name or supplier number."""
    latest = db.latest_results()
    needle = q.strip().lower()
    return [
        _summary(s, latest.get(s["id"]))
        for s in db.list_suppliers()
        if not needle or needle in s["name"].lower() or needle in s["number"].lower()
    ]


@app.post("/api/suppliers", status_code=201)
def create_supplier(body: SupplierIn, lang: str | None = None):
    if db.find_supplier_by_number(body.number):
        raise HTTPException(409, f"Lieferantennummer {body.number} existiert bereits")
    supplier_id = db.next_supplier_id()
    internal = body.figures.to_internal() if body.figures else {}
    db.upsert_supplier(_master_from_input(supplier_id, body), internal, [])
    report = pipeline.run_to_completion(supplier_id, lang=lang)
    return _summary(db.get_supplier(supplier_id), report)


@app.put("/api/suppliers/{supplier_id}")
def update_supplier(supplier_id: str, body: SupplierIn, lang: str | None = None):
    existing = _require_supplier(supplier_id)
    other = db.find_supplier_by_number(body.number)
    if other and other["id"] != supplier_id:
        raise HTTPException(409, f"Lieferantennummer {body.number} existiert bereits")
    # The source system stays the one the supplier came from.
    db.upsert_master({**_master_from_input(supplier_id, body), "source": existing.get("source", body.source)})
    if body.figures:
        db.save_internal(supplier_id, body.figures.to_internal())
    report = pipeline.run_to_completion(supplier_id, lang=lang)
    return _summary(db.get_supplier(supplier_id), report)


@app.delete("/api/suppliers/{supplier_id}", status_code=204)
def delete_supplier(supplier_id: str):
    _require_supplier(supplier_id)
    db.delete_supplier(supplier_id)


@app.get("/api/suppliers/{supplier_id}")
def supplier(supplier_id: str):
    master = _require_supplier(supplier_id)
    history = db.result_history(supplier_id)
    return {
        "supplier": _summary(master, history[0] if history else None),
        "report": history[0] if history else None,
        "history": [
            {"created_at": h["created_at"], "status": h["status"], "llm": h["llm"]}
            for h in reversed(history)
        ],
    }


@app.post("/api/suppliers/{supplier_id}/analyze")
def analyze(supplier_id: str, lang: str | None = None):
    _require_supplier(supplier_id)
    return _sse(pipeline.run(supplier_id, lang=lang))


@app.post("/api/cycle")
def quarterly_cycle(lang: str | None = None):
    """Runs the evaluation for the whole supplier base (escalations go to the cockpit only)."""

    def events():
        llm = LLM()
        for s in db.list_suppliers():
            yield {"type": "supplier", "supplier_id": s["id"], "name": s["name"]}
            report = pipeline.run_to_completion(s["id"], llm, lang=lang)
            yield {
                "type": "supplier_done",
                "supplier_id": s["id"],
                "status": report["status"],
            }
        yield {"type": "cycle_done"}

    return _sse(events())


# --- Source systems (SAP, other ERPs, manual entry) ------------------------------------


@app.get("/api/sources")
def sources():
    return [c.describe() for c in all_connectors()]


@app.get("/api/sources/search")
def search_sources(q: str = Query(min_length=1), source: list[str] | None = Query(default=None)):
    """Searches supplier numbers/names in the selected source systems (`source=sap&source=erp`)."""
    unknown = [s for s in source or [] if get_connector(s) is None]
    if unknown:
        raise HTTPException(400, f"Unbekannte Quelle: {', '.join(unknown)}")
    return search_all(q, source)


@app.post("/api/suppliers/import", status_code=201)
def import_supplier(body: ImportRequest, lang: str | None = None):
    """Creates a supplier from a source system and adds it to the monitoring."""
    connector = get_connector(body.source)
    if connector is None:
        raise HTTPException(400, f"Unbekannte Quelle: {body.source}")
    if db.find_supplier_by_number(body.number):
        raise HTTPException(409, f"Lieferantennummer {body.number} existiert bereits")
    try:
        record = connector.get_master(body.number)
    except ConnectorError as e:
        raise HTTPException(502, str(e)) from e
    if record is None:
        raise HTTPException(404, f"{body.number} in {connector.name} nicht gefunden")
    supplier_id = db.next_supplier_id()
    master = {
        "id": supplier_id,
        "number": record.number,
        "name": record.name,
        "street": record.street,
        "zip": record.zip,
        "city": record.city,
        "country": record.country,
        "website": record.website,
        "commodity": record.commodity or body.commodity,
        "buyer": {"name": record.buyer_name or body.buyer_name, "email": record.buyer_email or str(body.buyer_email or "")},
        "register_status": "green",
        "source": connector.id,
        "plant_ids": _check_plants(body.plant_ids),
    }
    master["location"] = geo.locate(master)
    try:
        internal = connector.get_internal_data(record.number) or {}
    except (NotImplementedError, ConnectorError):
        internal = {}
    db.upsert_supplier(master, internal, [])
    return _summary(master, pipeline.run_to_completion(supplier_id, lang=lang))


# --- Notifications & auto mode ---------------------------------------------------------


@app.get("/api/notifications")
def notifications():
    return db.list_notifications()


@app.get("/api/channels")
def channels():
    return [n.describe() for n in all_notifiers()]


@app.get("/api/automode")
def get_automode():
    return automode.get_state()


@app.put("/api/automode")
def put_automode(body: AutomodeUpdate):
    return automode.update_state(**body.model_dump(exclude_none=True))


@app.post("/api/automode/run")
async def run_automode():
    """Starts one auto-mode cycle immediately (in the background)."""
    if automode.get_state()["running"]:
        raise HTTPException(409, "Ein Lauf ist bereits aktiv")
    asyncio.create_task(asyncio.to_thread(automode.run_once))
    return {"started": True}


if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        file = FRONTEND_DIST / path
        return FileResponse(file if path and file.is_file() else FRONTEND_DIST / "index.html")
