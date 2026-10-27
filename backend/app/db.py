"""SQLite storage mirroring the reference model:
Internal Data Storage, External Data Storage and Result Data Storage (Figure 2).
"""

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

from .config import settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    master JSON NOT NULL
);
CREATE TABLE IF NOT EXISTS internal_data (
    supplier_id TEXT PRIMARY KEY REFERENCES suppliers(id),
    data JSON NOT NULL
);
CREATE TABLE IF NOT EXISTS external_data (
    supplier_id TEXT PRIMARY KEY REFERENCES suppliers(id),
    data JSON NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id TEXT NOT NULL REFERENCES suppliers(id),
    created_at TEXT NOT NULL,
    report JSON NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id TEXT NOT NULL REFERENCES suppliers(id),
    created_at TEXT NOT NULL,
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'inapp',
    status TEXT NOT NULL DEFAULT 'sent',
    error TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS plants (
    id TEXT PRIMARY KEY,
    data JSON NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value JSON NOT NULL
);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def connect():
    conn = sqlite3.connect(settings.db_path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with connect() as c:
        c.executescript(SCHEMA)


def is_empty() -> bool:
    with connect() as c:
        return c.execute("SELECT COUNT(*) FROM suppliers").fetchone()[0] == 0


def upsert_supplier(master: dict, internal: dict, external: list[dict]) -> None:
    with connect() as c:
        c.execute("INSERT OR REPLACE INTO suppliers VALUES (?, ?)", (master["id"], json.dumps(master)))
        c.execute("INSERT OR REPLACE INTO internal_data VALUES (?, ?)", (master["id"], json.dumps(internal)))
        c.execute(
            "INSERT OR REPLACE INTO external_data VALUES (?, ?, ?)", (master["id"], json.dumps(external), now())
        )


def upsert_master(master: dict) -> None:
    with connect() as c:
        c.execute("INSERT OR REPLACE INTO suppliers VALUES (?, ?)", (master["id"], json.dumps(master)))


def list_suppliers() -> list[dict]:
    with connect() as c:
        return [json.loads(r["master"]) for r in c.execute("SELECT master FROM suppliers ORDER BY id")]


def find_supplier_by_number(number: str) -> dict | None:
    n = number.strip().lower()
    return next((s for s in list_suppliers() if s["number"].lower() == n), None)


def next_supplier_id() -> str:
    with connect() as c:
        ids = [r["id"] for r in c.execute("SELECT id FROM suppliers")]
    numeric = [int(i[1:]) for i in ids if i[1:].isdigit()]
    return f"S{max(numeric, default=999) + 1}"


def save_internal(supplier_id: str, data: dict) -> None:
    with connect() as c:
        c.execute("INSERT OR REPLACE INTO internal_data VALUES (?, ?)", (supplier_id, json.dumps(data)))


def delete_supplier(supplier_id: str) -> None:
    with connect() as c:
        for table in ("notifications", "results", "external_data", "internal_data"):
            c.execute(f"DELETE FROM {table} WHERE supplier_id = ?", (supplier_id,))
        c.execute("DELETE FROM suppliers WHERE id = ?", (supplier_id,))


def list_plants() -> list[dict]:
    with connect() as c:
        return [json.loads(r["data"]) for r in c.execute("SELECT data FROM plants ORDER BY id")]


def get_plant(plant_id: str) -> dict | None:
    with connect() as c:
        row = c.execute("SELECT data FROM plants WHERE id = ?", (plant_id,)).fetchone()
        return json.loads(row["data"]) if row else None


def upsert_plant(plant: dict) -> None:
    with connect() as c:
        c.execute("INSERT OR REPLACE INTO plants VALUES (?, ?)", (plant["id"], json.dumps(plant)))


def delete_plant(plant_id: str) -> None:
    """Deletes a plant and removes it from every supplier linked to it."""
    with connect() as c:
        c.execute("DELETE FROM plants WHERE id = ?", (plant_id,))
    for s in list_suppliers():
        if plant_id in s.get("plant_ids", []):
            upsert_master({**s, "plant_ids": [p for p in s["plant_ids"] if p != plant_id]})


def next_plant_id() -> str:
    numeric = [int(p["id"][1:]) for p in list_plants() if p["id"][1:].isdigit()]
    return f"P{max(numeric, default=0) + 1:02d}"


def get_setting(key: str, default=None):
    with connect() as c:
        row = c.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return json.loads(row["value"]) if row else default


def set_setting(key: str, value) -> None:
    with connect() as c:
        c.execute("INSERT OR REPLACE INTO settings VALUES (?, ?)", (key, json.dumps(value)))


def get_supplier(supplier_id: str) -> dict | None:
    with connect() as c:
        row = c.execute("SELECT master FROM suppliers WHERE id = ?", (supplier_id,)).fetchone()
        return json.loads(row["master"]) if row else None


def get_internal(supplier_id: str) -> dict:
    with connect() as c:
        row = c.execute("SELECT data FROM internal_data WHERE supplier_id = ?", (supplier_id,)).fetchone()
        return json.loads(row["data"]) if row else {}


def get_external(supplier_id: str) -> list[dict]:
    with connect() as c:
        row = c.execute("SELECT data FROM external_data WHERE supplier_id = ?", (supplier_id,)).fetchone()
        return json.loads(row["data"]) if row else []


def save_external(supplier_id: str, docs: list[dict]) -> None:
    with connect() as c:
        c.execute("INSERT OR REPLACE INTO external_data VALUES (?, ?, ?)", (supplier_id, json.dumps(docs), now()))


def save_result(supplier_id: str, report: dict) -> int:
    with connect() as c:
        cur = c.execute(
            "INSERT INTO results (supplier_id, created_at, report) VALUES (?, ?, ?)",
            (supplier_id, report["created_at"], json.dumps(report)),
        )
        return cur.lastrowid


def latest_results() -> dict[str, dict]:
    with connect() as c:
        rows = c.execute(
            """SELECT r.supplier_id, r.report FROM results r
               JOIN (SELECT supplier_id, MAX(id) AS id FROM results GROUP BY supplier_id) m ON m.id = r.id"""
        )
        return {r["supplier_id"]: json.loads(r["report"]) for r in rows}


def result_history(supplier_id: str, limit: int = 20) -> list[dict]:
    with connect() as c:
        rows = c.execute(
            "SELECT report FROM results WHERE supplier_id = ? ORDER BY id DESC LIMIT ?", (supplier_id, limit)
        )
        return [json.loads(r["report"]) for r in rows]


def add_notification(
    supplier_id: str, recipient: str, subject: str, body: str, channel: str = "inapp", status: str = "sent", error: str = ""
) -> dict:
    created = now()
    with connect() as c:
        c.execute(
            """INSERT INTO notifications (supplier_id, created_at, recipient, subject, body, channel, status, error)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (supplier_id, created, recipient, subject, body, channel, status, error),
        )
    return {
        "supplier_id": supplier_id,
        "created_at": created,
        "recipient": recipient,
        "subject": subject,
        "body": body,
        "channel": channel,
        "status": status,
        "error": error,
    }


def list_notifications(limit: int = 50) -> list[dict]:
    with connect() as c:
        rows = c.execute("SELECT * FROM notifications ORDER BY id DESC LIMIT ?", (limit,))
        return [dict(r) for r in rows]
