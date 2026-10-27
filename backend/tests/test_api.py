import pytest
from fastapi.testclient import TestClient

from app import config


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "db_path", tmp_path / "api.db")
    monkeypatch.setattr(config.settings, "seed_demo_data", False)
    monkeypatch.setattr(config.settings, "llm_provider", "demo")
    from app.main import app

    with TestClient(app) as c:
        yield c


SUPPLIER = {
    "number": "70012345",
    "name": "Muster Drehteile GmbH",
    "commodity": "Metall & Umformung",
    "city": "Pforzheim",
    "country": "de",
    "buyer_name": "Erika Muster",
    "buyer_email": "erika.muster@example.com",
}


def test_create_supplier_with_master_data_only(client):
    r = client.post("/api/suppliers", json=SUPPLIER)
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["country"] == "DE"
    assert s["source"] == "manual"
    assert s["status"] == "none"
    assert len(s["missing_sources"]) == 4

    assert client.post("/api/suppliers", json=SUPPLIER).status_code == 409


def test_create_supplier_with_figures_is_assessed(client):
    figures = {
        "years": [
            {"year": 2023, "revenue": 30, "purchase": 12},
            {"year": 2024, "revenue": 29, "purchase": 15},
            {"year": 2025, "revenue": 27, "purchase": 16},
        ],
        "plan_next_year": 12.5,
        "pd_previous": 0.8,
        "pd_previous_date": "2024-06-01",
        "pd_current": 2.4,
        "pd_current_date": "2025-09-01",
        "ppm_current": 60,
        "ppm_previous": 55,
        "otd": 96,
    }
    r = client.post("/api/suppliers", json={**SUPPLIER, "figures": figures})
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["customer_share"] == pytest.approx(59.3, abs=0.1)
    assert s["status"] == "escalated"
    assert s["escalate"] is True
    assert "score" not in s
    assert s["missing_sources"] == []

    detail = client.get(f"/api/suppliers/{s['id']}").json()
    ids = {k["id"] for k in detail["report"]["kpis"]}
    assert {"customer_share", "revenue_forecast", "plan_change", "pd_latest", "pd_trend", "ppm", "otd"} <= ids


def test_search_by_name_and_number(client):
    client.post("/api/suppliers", json=SUPPLIER)
    client.post("/api/suppliers", json={**SUPPLIER, "number": "70099999", "name": "Andere Firma AG"})
    assert [s["name"] for s in client.get("/api/suppliers", params={"q": "drehteile"}).json()] == ["Muster Drehteile GmbH"]
    assert [s["number"] for s in client.get("/api/suppliers", params={"q": "7009"}).json()] == ["70099999"]


def test_delete_supplier(client):
    sid = client.post("/api/suppliers", json=SUPPLIER).json()["id"]
    assert client.delete(f"/api/suppliers/{sid}").status_code == 204
    assert client.get(f"/api/suppliers/{sid}").status_code == 404


def test_source_systems_are_registered(client):
    sources = {s["id"]: s for s in client.get("/api/sources").json()}
    assert sources["local"]["configured"] is True
    assert sources["sap"]["configured"] is False
    assert sources["erp"]["configured"] is False

    client.post("/api/suppliers", json=SUPPLIER)
    r = client.get("/api/sources/search", params={"q": "7001", "source": ["local", "sap"]}).json()
    assert [x["number"] for x in r["results"]] == ["70012345"]
    assert "nicht konfiguriert" in r["errors"]["sap"]
    assert client.get("/api/sources/search", params={"q": "x", "source": "oracle"}).status_code == 400


def test_import_from_unconfigured_sap_fails_cleanly(client):
    r = client.post("/api/suppliers/import", json={"source": "sap", "number": "100200"})
    assert r.status_code == 502
    assert "nicht konfiguriert" in r.json()["detail"]


def test_automode_settings_and_run(client, monkeypatch):
    from app import automode
    from app.notifiers.teams import TeamsNotifier

    state = client.put("/api/automode", json={"enabled": False, "interval_minutes": 60, "channels": ["outlook", "teams"]}).json()
    assert state["interval_minutes"] == 60

    client.post("/api/suppliers", json={**SUPPLIER, "figures": {"pd_current": 4.5, "pd_previous": 1.0}})
    sent = []
    monkeypatch.setattr(TeamsNotifier, "configured", property(lambda self: True))
    monkeypatch.setattr(TeamsNotifier, "send", lambda self, m, r=None: sent.append(m))

    summary = automode.run_once()
    assert summary["suppliers"] == 1
    assert summary["escalations"] == 1
    assert summary["sent"] == 1  # Teams
    assert summary["failed"] == 1  # Outlook not configured
    assert [r.email for r in sent[0].recipients] == [SUPPLIER["buyer_email"]]

    channels = {n["channel"]: n["status"] for n in client.get("/api/notifications").json()}
    assert channels == {"inapp": "sent", "teams": "sent", "outlook": "failed"}
    assert client.get("/api/automode").json()["last_result"]["escalations"] == 1


def test_outlook_uses_graph_send_mail(monkeypatch):
    from app.notifiers import outlook
    from app.notifiers.base import Recipient, RiskMessage

    for key, value in {
        "ms_tenant_id": "tenant",
        "ms_client_id": "client",
        "ms_client_secret": "secret",
        "outlook_sender": "risk-radar@example.com",
    }.items():
        monkeypatch.setattr(config.settings, key, value)
    outlook._token.update(value="", expires=0)
    calls = []

    class Resp:
        def __init__(self, status, payload=None):
            self.status_code, self._payload, self.text = status, payload or {}, ""

        def raise_for_status(self):
            pass

        def json(self):
            return self._payload

    def fake_post(url, **kwargs):
        calls.append((url, kwargs))
        if "oauth2" in url:
            return Resp(200, {"access_token": "tok", "expires_in": 3600})
        return Resp(202)

    monkeypatch.setattr(outlook.httpx, "post", fake_post)
    erika = Recipient(name="Erika", email="erika@example.com", role="buyer")
    outlook.OutlookNotifier().send(
        RiskMessage(
            supplier_id="S1", supplier_name="X GmbH", supplier_number="1", recipients=[erika], plants=[],
            lang="en", subject="Test", summary="s", recommendation="r", measures=["m"], link="http://x",
        ),
        erika,
    )
    assert calls[0][0] == "https://login.microsoftonline.com/tenant/oauth2/v2.0/token"
    url, kwargs = calls[1]
    assert url == "https://graph.microsoft.com/v1.0/users/risk-radar@example.com/sendMail"
    assert kwargs["headers"]["Authorization"] == "Bearer tok"
    assert kwargs["json"]["message"]["toRecipients"][0]["emailAddress"]["address"] == "erika@example.com"


PLANT = {
    "name": "Werk Nord",
    "street": "Hafenstraße 1",
    "zip": "20457",
    "city": "Hamburg",
    "country": "de",
    "contacts": [
        {"name": "Paul Nord", "email": "p.nord@example.com", "role": "Werkleitung"},
        {"name": "Erika Muster", "email": "erika.muster@example.com", "role": "Einkauf"},
    ],
}


def test_plants_crud_and_geocoding(client):
    r = client.post("/api/plants", json=PLANT)
    assert r.status_code == 201, r.text
    plant = r.json()
    assert plant["id"] == "P01"
    assert plant["location"]["precision"] == "city"
    assert abs(plant["location"]["lat"] - 53.55) < 0.2

    moved = client.put(f"/api/plants/{plant['id']}", json={**PLANT, "lat": 10.0, "lon": 20.0}).json()
    assert moved["location"] == {"lat": 10.0, "lon": 20.0, "precision": "manual", "source": "manual"}

    s = client.post("/api/suppliers", json={**SUPPLIER, "street": "Weg 2", "plant_ids": ["P01"]}).json()
    assert s["plant_ids"] == ["P01"]
    assert client.get("/api/plants").json()[0]["supplier_ids"] == [s["id"]]
    assert client.post("/api/suppliers", json={**SUPPLIER, "number": "2", "plant_ids": ["P99"]}).status_code == 400

    assert client.delete("/api/plants/P01").status_code == 204
    assert client.get(f"/api/suppliers/{s['id']}").json()["supplier"]["plant_ids"] == []


def test_alert_reaches_all_contacts_of_linked_plants(client, monkeypatch):
    from app import config as cfg
    from app.notifiers import outlook

    client.post("/api/plants", json=PLANT)
    client.post("/api/plants", json={**PLANT, "name": "Werk Süd", "city": "München", "contacts": [
        {"name": "Sara Süd", "email": "s.sued@example.com", "role": "Disposition"},
    ]})
    for key in ("ms_tenant_id", "ms_client_id", "ms_client_secret", "outlook_sender"):
        monkeypatch.setattr(cfg.settings, key, "x@example.com")
    mails = []
    monkeypatch.setattr(outlook, "graph_token", lambda: "tok")
    monkeypatch.setattr(
        outlook.httpx, "post",
        lambda url, **kw: mails.append(kw["json"]) or type("R", (), {"status_code": 202, "text": ""})(),
    )
    client.put("/api/automode", json={"channels": ["outlook"], "lang": "en"})
    client.post(
        "/api/suppliers",
        json={**SUPPLIER, "plant_ids": ["P01", "P02"], "figures": {"pd_current": 4.5, "pd_previous": 1.0}},
    )
    from app import automode

    automode.run_once()
    to = [m["message"]["toRecipients"][0]["emailAddress"]["address"] for m in mails]
    # buyer once (also a plant contact), plus every other plant contact
    assert sorted(to) == ["erika.muster@example.com", "p.nord@example.com", "s.sued@example.com"]
    assert mails[0]["message"]["subject"].startswith("[Early warning]")
    assert "Werk Nord" in mails[0]["message"]["body"]["content"]


def test_language_of_generated_texts(client):
    en = client.post("/api/suppliers?lang=en", json={**SUPPLIER, "figures": {"pd_current": 4.5, "pd_previous": 1.0}}).json()
    report = client.get(f"/api/suppliers/{en['id']}").json()["report"]
    assert report["lang"] == "en"
    assert report["decision"]["justification"].startswith("Escalation")
    assert "Eskalation" not in report["argumentation"]["summary"]
