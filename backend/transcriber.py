"""
transcriber.py — Whisper API wrapper.

Sends WAV bytes to OpenAI's Whisper endpoint and returns a plain-text
transcript.  Uses httpx with a short timeout so the pipeline stays snappy.
"""

import io
import time
from openai import AsyncOpenAI

_client = AsyncOpenAI()   # picks up OPENAI_API_KEY from env


async def transcribe(wav_bytes: bytes, language: str = "en") -> str | None:
    """
    Transcribe a WAV buffer via Whisper-1.

    Returns the transcript string, or None if the audio was silent /
    contained no recognisable speech.

    Args:
        wav_bytes: In-memory WAV file.
        language:  ISO-639-1 hint to improve accuracy (source language).
    """
    if not wav_bytes:
        return None

    file_tuple = ("audio.wav", io.BytesIO(wav_bytes), "audio/wav")

    try:
        response = await _client.audio.transcriptions.create(
            model    = "whisper-1",
            file     = file_tuple,
            language = language,
            response_format = "verbose_json",   # gives us segment timestamps
            timestamp_granularities = ["segment"],
        )
    except Exception as exc:
        print(f"[WHISPER ERROR] {exc}")
        return None

    text = response.text.strip()
    return text if text else None


async def transcribe_with_timestamps(wav_bytes: bytes, language: str = "en") -> list[dict]:
    """
    Returns segment-level dicts: {"start": float, "end": float, "text": str}
    Useful for driving the SRT exporter.
    """
    if not wav_bytes:
        return []

    file_tuple = ("audio.wav", io.BytesIO(wav_bytes), "audio/wav")

    try:
        response = await _client.audio.transcriptions.create(
            model    = "whisper-1",
            file     = file_tuple,
            language = language,
            response_format = "verbose_json",
            timestamp_granularities = ["segment"],
        )
    except Exception as exc:
        print(f"[WHISPER ERROR] {exc}")
        return []

    return [
        {"start": s.start, "end": s.end, "text": s.text.strip()}
        for s in (response.segments or [])
        if s.text.strip()
    ]
