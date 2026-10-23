import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import db, pipeline, seed
from .config import settings
from .llm import LLM
from .modules.internal_module import THRESHOLDS

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init_db()
    if db.is_empty():
        seed.seed()
        # Initial assessment with the rule-based agents so the cockpit is populated
        # without spending LLM tokens; real runs are triggered from the UI.
        bootstrap = LLM("demo")
        for s in db.list_suppliers():
            pipeline.run_to_completion(s["id"], bootstrap, notify=True)
    yield


app = FastAPI(title="Supplier Risk Early Warning", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _summary(master: dict, report: dict | None) -> dict:
    out = {**master}
    if report:
        kpi = {k["id"]: k for k in report["kpis"]}
        series = report["series"]
        out.update(
            score=report["scoring"]["score"],
            traffic_light=report["decision"]["traffic_light"],
            escalate=report["decision"]["escalate"],
            assessed_at=report["created_at"],
            as_of=report["as_of"],
            customer_share=kpi["customer_share"]["value"],
            pd=kpi["pd_latest"]["value"],
            revenue_forecast=kpi.get("revenue_forecast", {}).get("value"),
            purchase_volume=series["purchase"][-1],
            revenue=series["revenue"][-1],
            external_risks=sum(1 for d in report["external"] if d["signal"] == "risk"),
            headline=report["argumentation"]["summary"],
        )
    return out


def _sse(events) -> StreamingResponse:
    def gen():
        for e in events:
            yield f"data: {json.dumps(e, ensure_ascii=False)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@app.get("/api/meta")
def meta():
    suppliers = db.list_suppliers()
    return {
        "llm": LLM().label,
        "provider": settings.llm_provider,
        "crawler_enabled": settings.crawler_enabled,
        "commodities": sorted({s["commodity"] for s in suppliers}),
        "countries": sorted({s["country"] for s in suppliers}),
        "thresholds": THRESHOLDS,
        "steps": pipeline.STEPS,
    }


@app.get("/api/suppliers")
def suppliers():
    latest = db.latest_results()
    return [_summary(s, latest.get(s["id"])) for s in db.list_suppliers()]


@app.get("/api/suppliers/{supplier_id}")
def supplier(supplier_id: str):
    master = db.get_supplier(supplier_id)
    if not master:
        raise HTTPException(404, "Lieferant nicht gefunden")
    history = db.result_history(supplier_id)
    return {
        "supplier": _summary(master, history[0] if history else None),
        "report": history[0] if history else None,
        "history": [
            {"created_at": h["created_at"], "score": h["scoring"]["score"], "traffic_light": h["decision"]["traffic_light"], "llm": h["llm"]}
            for h in reversed(history)
        ],
        "backtest": backtest(master, history[0]) if master.get("is_case_study") and history else None,
    }


def backtest(master: dict, report: dict) -> dict:
    case = master["case_study"]
    actual = {a["year"]: a for a in case["actual"]}
    rows = []
    for f in report["forecast"]:
        a = actual.get(f["year"])
        if a:
            rows.append(
                {
                    "year": f["year"],
                    "forecast": f["revenue"],
                    "actual": a["revenue"],
                    "ape": round(abs(f["revenue"] - a["revenue"]) / a["revenue"] * 100, 2),
                    "actual_share": round(a["customer_share"] * 100, 1),
                }
            )
    mape = round(sum(r["ape"] for r in rows) / len(rows), 2) if rows else None
    return {**case, "rows": rows, "mape": mape}


@app.post("/api/suppliers/{supplier_id}/analyze")
def analyze(supplier_id: str):
    if not db.get_supplier(supplier_id):
        raise HTTPException(404, "Lieferant nicht gefunden")
    return _sse(pipeline.run(supplier_id))


@app.post("/api/cycle")
def quarterly_cycle():
    """Runs the quarterly evaluation for the whole supplier base."""

    def events():
        llm = LLM()
        for s in db.list_suppliers():
            yield {"type": "supplier", "supplier_id": s["id"], "name": s["name"]}
            report = pipeline.run_to_completion(s["id"], llm)
            yield {
                "type": "supplier_done",
                "supplier_id": s["id"],
                "traffic_light": report["decision"]["traffic_light"],
                "score": report["scoring"]["score"],
            }
        yield {"type": "cycle_done"}

    return _sse(events())


@app.get("/api/notifications")
def notifications():
    return db.list_notifications()


if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        file = FRONTEND_DIST / path
        return FileResponse(file if path and file.is_file() else FRONTEND_DIST / "index.html")
