"""
srt_exporter.py — Timestamped SRT file generator.

Produces broadcast-ready subtitle files compatible with
Warner Bros. Discovery's reversion delivery specifications.

SRT format:
    <index>
    HH:MM:SS,mmm --> HH:MM:SS,mmm
    <text>
    <blank line>
"""

import os
from datetime import datetime, timezone


def _seconds_to_srt_time(total_seconds: float) -> str:
    """Convert a float (seconds) to SRT timestamp: HH:MM:SS,mmm"""
    total_ms  = int(total_seconds * 1000)
    ms        = total_ms % 1000
    total_s   = total_ms // 1000
    h         = total_s // 3600
    m         = (total_s % 3600) // 60
    s         = total_s % 60
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


class SRTExporter:
    """
    Accumulates translated segments and flushes to disk as a timestamped
    .srt file.

    Usage:
        exporter = SRTExporter(target_lang="fr", output_dir="./exports")
        exporter.add_segment(start=0.0, end=3.2, text="Bonjour le monde")
        exporter.save()          # writes exports/2026-03-06T142233_fr.srt
    """

    def __init__(
        self,
        target_lang : str  = "en",
        output_dir  : str  = "./exports",
        session_id  : str  | None = None,
    ):
        self.target_lang = target_lang
        self.output_dir  = output_dir
        self._segments: list[dict] = []
        self._counter  = 1

        os.makedirs(self.output_dir, exist_ok=True)

        ts            = datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H%M%S")
        suffix        = f"_{session_id}" if session_id else ""
        self.filename = os.path.join(
            self.output_dir,
            f"{ts}{suffix}_{self.target_lang}.srt",
        )

    def add_segment(self, start: float, end: float, text: str):
        """Append a single subtitle segment."""
        self._segments.append({
            "index": self._counter,
            "start": start,
            "end"  : end,
            "text" : text.strip(),
        })
        self._counter += 1

    def add_segments_batch(self, segments: list[dict], use_translation: bool = True):
        """
        Add a batch from translate_segments() output.
        Each dict must have: start, end, text, and optionally translation.
        """
        for seg in segments:
            text = seg.get("translation", seg["text"]) if use_translation else seg["text"]
            self.add_segment(seg["start"], seg["end"], text)

    def to_string(self) -> str:
        """Render the accumulated segments as an SRT string."""
        blocks = []
        for seg in self._segments:
            t_start = _seconds_to_srt_time(seg["start"])
            t_end   = _seconds_to_srt_time(seg["end"])
            blocks.append(
                f"{seg['index']}\n"
                f"{t_start} --> {t_end}\n"
                f"{seg['text']}\n"
            )
        return "\n".join(blocks)

    def save(self) -> str:
        """Write to disk and return the absolute file path."""
        content = self.to_string()
        with open(self.filename, "w", encoding="utf-8") as fh:
            fh.write(content)
        print(f"[SRT] Saved → {self.filename}  ({self._counter - 1} cues)")
        return self.filename

    def clear(self):
        """Reset the segment buffer (keeps filename/session context)."""
        self._segments = []
        self._counter  = 1
