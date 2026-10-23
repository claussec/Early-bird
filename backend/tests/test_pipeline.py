import pytest

from app import config


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "db_path", tmp_path / "test.db")
    from app import db, seed

    db.init_db()
    seed.seed()


def test_case_study_reproduces_paper_figures():
    from app import db
    from app.modules.internal_module import compute_kpis

    kpis = {k["id"]: k for k in compute_kpis(db.get_internal("S0999"))["kpis"]}
    assert kpis["customer_share"]["value"] == 62.8
    assert kpis["customer_share"]["status"] == "critical"
    assert kpis["revenue_forecast"]["value"] == pytest.approx(-13.12, abs=0.02)
    assert kpis["pd_latest"]["value"] == 2.0
    assert kpis["plan_volatility"]["status"] != "ok"
    assert kpis["ppm"]["status"] == "ok"


def test_case_study_is_escalated_and_backtest_mape():
    from app import db, pipeline
    from app.llm import LLM
    from app.main import backtest

    report = pipeline.run_to_completion("S0999", LLM("demo"))
    assert report["decision"]["traffic_light"] == "red"
    assert report["decision"]["escalate"] is True
    assert report["notification"] is not None
    bt = backtest(db.get_supplier("S0999"), report)
    assert bt["mape"] == pytest.approx(2.37, abs=0.05)


def test_divergence_detects_hidden_risk():
    from app import pipeline
    from app.llm import LLM

    report = pipeline.run_to_completion("S1006", LLM("demo"))  # Alpen Sensorik: good rating, bad news
    assert "divergence" in [c["id"] for c in report["combinations"]]
    assert report["decision"]["traffic_light"] != "green"


def test_healthy_supplier_stays_green():
    from app import pipeline
    from app.llm import LLM

    report = pipeline.run_to_completion("S1000", LLM("demo"))
    assert report["decision"]["traffic_light"] == "green"
    assert report["decision"]["escalate"] is False
