"""Runtime configuration, read from environment variables."""

import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Settings:
    # demo | anthropic | ollama
    llm_provider: str = field(default_factory=lambda: os.getenv("LLM_PROVIDER", "demo"))
    anthropic_model: str = field(default_factory=lambda: os.getenv("ANTHROPIC_MODEL", "claude-opus-5-5"))
    anthropic_effort: str = field(default_factory=lambda: os.getenv("ANTHROPIC_EFFORT", "medium"))
    ollama_url: str = field(default_factory=lambda: os.getenv("OLLAMA_URL", "http://localhost:11434"))
    ollama_model: str = field(default_factory=lambda: os.getenv("OLLAMA_MODEL", "llama3.1"))
    # Live web crawling in the External Module. Off by default so the demo runs offline.
    crawler_enabled: bool = field(default_factory=lambda: os.getenv("CRAWLER_ENABLED", "false").lower() == "true")
    db_path: Path = field(
        default_factory=lambda: Path(os.getenv("DB_PATH", Path(__file__).resolve().parent.parent / "risk.db"))
    )
    # Artificial delay between pipeline steps in demo mode, so the UI can show the workflow.
    demo_step_delay: float = field(default_factory=lambda: float(os.getenv("DEMO_STEP_DELAY", "0.6")))


settings = Settings()
