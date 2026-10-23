"""Runtime configuration, read from environment variables."""

import os
from dataclasses import dataclass, field
from pathlib import Path


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default)


def _flag(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).lower() == "true"


@dataclass
class Settings:
    # demo | anthropic | ollama
    llm_provider: str = field(default_factory=lambda: _env("LLM_PROVIDER", "demo"))
    anthropic_model: str = field(default_factory=lambda: _env("ANTHROPIC_MODEL", "claude-opus-5-5"))
    anthropic_effort: str = field(default_factory=lambda: _env("ANTHROPIC_EFFORT", "medium"))
    ollama_url: str = field(default_factory=lambda: _env("OLLAMA_URL", "http://localhost:11434"))
    ollama_model: str = field(default_factory=lambda: _env("OLLAMA_MODEL", "llama3.1"))
    # Live web crawling in the External Module. Off by default so the demo runs offline.
    crawler_enabled: bool = field(default_factory=lambda: _flag("CRAWLER_ENABLED"))
    db_path: Path = field(
        default_factory=lambda: Path(_env("DB_PATH", str(Path(__file__).resolve().parent.parent / "risk.db")))
    )
    # Fill an empty database with fictitious demo suppliers on first start.
    seed_demo_data: bool = field(default_factory=lambda: _flag("SEED_DEMO_DATA", "true"))
    # Artificial delay between pipeline steps in demo mode, so the UI can show the workflow.
    demo_step_delay: float = field(default_factory=lambda: float(_env("DEMO_STEP_DELAY", "0.6")))

    # --- Source systems (supplier master and transactional data) -------------------------
    sap_base_url: str = field(default_factory=lambda: _env("SAP_BASE_URL"))
    sap_client: str = field(default_factory=lambda: _env("SAP_CLIENT"))
    sap_user: str = field(default_factory=lambda: _env("SAP_USER"))
    sap_password: str = field(default_factory=lambda: _env("SAP_PASSWORD"))
    erp_name: str = field(default_factory=lambda: _env("ERP_NAME", "ERP (REST)"))
    erp_base_url: str = field(default_factory=lambda: _env("ERP_BASE_URL"))
    erp_token: str = field(default_factory=lambda: _env("ERP_TOKEN"))

    # --- Microsoft 365 (Outlook via Microsoft Graph, Teams via Workflows webhook) --------
    ms_tenant_id: str = field(default_factory=lambda: _env("MS_TENANT_ID"))
    ms_client_id: str = field(default_factory=lambda: _env("MS_CLIENT_ID"))
    ms_client_secret: str = field(default_factory=lambda: _env("MS_CLIENT_SECRET"))
    outlook_sender: str = field(default_factory=lambda: _env("OUTLOOK_SENDER"))
    teams_webhook_url: str = field(default_factory=lambda: _env("TEAMS_WEBHOOK_URL"))
    app_base_url: str = field(default_factory=lambda: _env("APP_BASE_URL", "http://localhost:8000"))

    # --- Auto mode -------------------------------------------------------------------------
    automode_enabled: bool = field(default_factory=lambda: _flag("AUTOMODE_ENABLED"))
    automode_interval_minutes: int = field(default_factory=lambda: int(_env("AUTOMODE_INTERVAL_MINUTES", "1440")))
    automode_channels: list[str] = field(
        default_factory=lambda: [c.strip() for c in _env("AUTOMODE_CHANNELS", "outlook,teams").split(",") if c.strip()]
    )


settings = Settings()
