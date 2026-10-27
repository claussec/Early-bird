import pytest

from app import config


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "db_path", tmp_path / "test.db")
    from app import db, seed

    db.init_db()
    seed.seed()


def run(supplier_id):
    from app import pipeline
    from app.llm import LLM

    return pipeline.run_to_completion(supplier_id, LLM("demo"))


def test_demo_data_contains_no_case_study():
    from app import db

    names = [s["name"] for s in db.list_suppliers()]
    assert len(names) == 16
    assert not any("Fallstudie" in n for n in names)


def test_no_numeric_score_in_report():
    report = run("S1002")
    assert "scoring" not in report
    assert all("points" not in i and "weight" not in i for i in report["indicators"])
    assert "traffic_light" not in report["decision"]


def test_no_risk_stops_after_internal_agent():
    """Figure 2: Risk? = no → evaluation next quarter, Decision Module skipped."""
    report = run("S1000")  # Kessler: healthy
    assert report["risk_check"]["risk"] is False
    assert report["status"] == "none"
    assert report["indicators"] == []
    assert report["decision"]["escalate"] is False


def test_critical_supplier_escalates_with_argumentation():
    report = run("S1002")  # Vogtland: critical profile
    assert report["risk_check"]["risk"] is True
    assert report["status"] == "escalated"
    assert {"dependency_decline", "rating_planning"} <= {c["id"] for c in report["combinations"]}
    assert report["argumentation"]["arguments"]
    assert all(a["indicator_ids"] for a in report["argumentation"]["arguments"])
    assert [d["channel"] for d in report["deliveries"]] == ["inapp"]


def test_divergence_detects_hidden_risk():
    report = run("S1006")  # Alpen Sensorik: rating fine, negative web signals
    assert "divergence" in [c["id"] for c in report["combinations"]]
    assert report["status"] == "escalated"


def test_quality_issues_alone_do_not_escalate():
    """Financial signals are prioritized over quality signals."""
    report = run("S1007")  # Lombarda: quality problems, finances stable
    assert report["status"] == "risk"
    assert report["decision"]["escalate"] is False
    risks = [i for i in report["indicators"] if i["type"] == "risk"]
    assert risks and all(i["priority"] == "operational" for i in risks)


def test_demo_plants_and_recipients():
    from app import db, pipeline

    assert [p["id"] for p in db.list_plants()] == ["P01", "P02", "P03"]
    master = db.get_supplier("S1002")  # linked to two plants
    recipients, plants = pipeline.recipients_for(master)
    assert len(plants) == 2
    emails = [r.email for r in recipients]
    assert len(emails) == len(set(emails))
    assert master["buyer"]["email"] in emails
    assert all(s["name"].endswith("(Demo)") for s in db.list_suppliers())
    assert all(s["location"] for s in db.list_suppliers())
