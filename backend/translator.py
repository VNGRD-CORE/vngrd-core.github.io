"""
translator.py — GPT-4o Localization Specialist.

Translates transcribed text while preserving broadcast/technical accuracy,
speaker register, and timing cues.  Designed for Warner Bros. Discovery-style
reversion workflows.
"""

from openai import AsyncOpenAI

_client = AsyncOpenAI()

# ── Language config ───────────────────────────────────────────────────────────
SUPPORTED_LANGUAGES: dict[str, str] = {
    "nl": "Dutch",
    "fr": "French",
    "it": "Italian",
    "es": "Spanish",
}

# ── System prompt ─────────────────────────────────────────────────────────────
_SYSTEM_PROMPT = """\
You are a senior Localization Specialist with 15 years of experience delivering
broadcast-quality reversions for major content distributors (Warner Bros.
Discovery, HBO Max, Eurosport).

Your task:
- Translate the provided English transcript into {target_language}.
- Preserve technical broadcast terminology (e.g. MCR, OB, TX, VT, uplink,
  handover, SOT, VO) in widely accepted {target_language} equivalents or keep
  them as industry-standard English abbreviations if no equivalent exists.
- Match the original speaker's register (formal/informal/urgent).
- Keep sentence rhythm suitable for subtitling: avoid over-long clauses.
- Do NOT add explanations, footnotes, or translator notes.
- Output ONLY the translated text. Nothing else.
"""


async def translate(text: str, target_lang: str) -> str | None:
    """
    Translate `text` into `target_lang` (ISO-639-1 code).

    Returns the translated string, or None on error.
    """
    if not text or target_lang not in SUPPORTED_LANGUAGES:
        return None

    target_language = SUPPORTED_LANGUAGES[target_lang]
    system_msg      = _SYSTEM_PROMPT.format(target_language=target_language)

    try:
        response = await _client.chat.completions.create(
            model    = "gpt-4o",
            messages = [
                {"role": "system",  "content": system_msg},
                {"role": "user",    "content": text},
            ],
            temperature = 0.2,    # Low temp = consistent, accurate output
            max_tokens  = 512,
        )
    except Exception as exc:
        print(f"[GPT-4o TRANSLATE ERROR] {exc}")
        return None

    result = response.choices[0].message.content.strip()
    return result if result else None


async def translate_segments(
    segments: list[dict],
    target_lang: str,
) -> list[dict]:
    """
    Translate a list of timed segments in parallel.

    Each segment: {"start": float, "end": float, "text": str}
    Returns segments with an added "translation" key.
    """
    import asyncio

    async def _translate_one(seg: dict) -> dict:
        translation = await translate(seg["text"], target_lang)
        return {**seg, "translation": translation or seg["text"]}

    return await asyncio.gather(*[_translate_one(s) for s in segments])
