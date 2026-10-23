import pytest

from app import config


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "db_path", tmp_path / "test.db")
    from app import db, seed

    db.init_db()
    seed.seed()


def test_demo_data_contains_no_case_study():
    from app import db

    names = [s["name"] for s in db.list_suppliers()]
    assert len(names) == 16
    assert not any("Fallstudie" in n for n in names)


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


def test_critical_supplier_escalates_to_cockpit():
    from app import pipeline
    from app.llm import LLM

    report = pipeline.run_to_completion("S1002", LLM("demo"))  # Vogtland: critical profile
    assert report["decision"]["traffic_light"] == "red"
    assert [d["channel"] for d in report["deliveries"]] == ["inapp"]
