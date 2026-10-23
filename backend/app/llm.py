"""LLM providers for the AI agents.

- demo:      no LLM. Agents fall back to their deterministic, rule-based logic.
- anthropic: Claude via the Anthropic API (structured outputs).
- ollama:    a local model (the paper's "offline LLM" for confidential data).
"""

import json
import logging
from typing import TypeVar

import anthropic
import httpx
from pydantic import BaseModel

from .config import settings

log = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)


class LLMUnavailable(Exception):
    """Raised when no LLM is configured or the call failed; agents then use their rule-based fallback."""


class LLM:
    def __init__(self, provider: str | None = None):
        self.provider = provider or settings.llm_provider
        self._client = anthropic.Anthropic() if self.provider == "anthropic" else None

    @property
    def label(self) -> str:
        if self.provider == "anthropic":
            return f"Claude ({settings.anthropic_model})"
        if self.provider == "ollama":
            return f"Ollama ({settings.ollama_model}, offline)"
        return "Demo (regelbasiert, ohne LLM)"

    def structured(self, system: str, prompt: str, schema: type[T]) -> T:
        if self.provider == "anthropic":
            return self._anthropic(system, prompt, schema)
        if self.provider == "ollama":
            return self._ollama(system, prompt, schema)
        raise LLMUnavailable("demo mode")

    def _anthropic(self, system: str, prompt: str, schema: type[T]) -> T:
        try:
            response = self._client.beta.messages.parse(
                model=settings.anthropic_model,
                max_tokens=16000,
                system=system,
                messages=[{"role": "user", "content": prompt}],
                output_format=schema,
                output_config={"effort": settings.anthropic_effort},
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.APIConnectionError as e:
            raise LLMUnavailable(f"Keine Verbindung zur Anthropic API: {e}") from e
        except anthropic.RateLimitError as e:
            raise LLMUnavailable("Rate Limit der Anthropic API erreicht") from e
        except anthropic.APIStatusError as e:
            raise LLMUnavailable(f"Anthropic API Fehler {e.status_code}: {e.message}") from e
        if response.stop_reason == "refusal" or response.parsed_output is None:
            raise LLMUnavailable(f"Keine verwertbare Antwort (stop_reason={response.stop_reason})")
        return response.parsed_output

    def _ollama(self, system: str, prompt: str, schema: type[T]) -> T:
        try:
            r = httpx.post(
                f"{settings.ollama_url}/api/chat",
                json={
                    "model": settings.ollama_model,
                    "stream": False,
                    "format": schema.model_json_schema(),
                    "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                },
                timeout=300,
            )
            r.raise_for_status()
            return schema.model_validate(json.loads(r.json()["message"]["content"]))
        except (httpx.HTTPError, ValueError, KeyError) as e:
            raise LLMUnavailable(f"Ollama nicht verfügbar: {e}") from e
