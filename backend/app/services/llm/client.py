from sqlalchemy.orm import Session
from app.models.app_settings import AppSettings


class LLMClient:
    """Client LLM configurable (OpenAI ou Anthropic)."""

    def __init__(self, db: Session):
        def get(key: str) -> str | None:
            row = db.query(AppSettings).filter(AppSettings.key == key).first()
            return row.value if row else None

        self.provider = get("llm_provider") or "anthropic"
        self.model = get("llm_model") or "claude-sonnet-4-6"
        self.api_key = get("llm_api_key")

    async def analyze_dor(self, work_item_content: str, pbr_notes: str) -> dict:
        """Analyse DOR d'un work item et retourne note (1-5) + commentaire."""
        prompt = f"""Tu es expert en Product Backlog Refinement SAFe.
Analyse le work item suivant et attribue une note DOR de 1 (non prêt) à 5 (prêt).

Work item :
{work_item_content}

Notes PBR existantes :
{pbr_notes}

Réponds en JSON : {{"note": <1-5>, "commentaire": "<justification détaillée>"}}"""

        if self.provider == "anthropic":
            return await self._call_anthropic(prompt)
        elif self.provider == "openai":
            return await self._call_openai(prompt)
        else:
            raise ValueError(f"Provider LLM non supporté : {self.provider}")

    async def _call_anthropic(self, prompt: str) -> dict:
        import anthropic
        import json

        client = anthropic.AsyncAnthropic(api_key=self.api_key)
        message = await client.messages.create(
            model=self.model,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        text = message.content[0].text
        return json.loads(text)

    async def _call_openai(self, prompt: str) -> dict:
        from openai import AsyncOpenAI
        import json

        client = AsyncOpenAI(api_key=self.api_key)
        response = await client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
        )
        return json.loads(response.choices[0].message.content)
