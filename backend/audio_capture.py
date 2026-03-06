"""
audio_capture.py — Real-time microphone sniffing with PyAudio.

Produces a continuous stream of raw PCM frames that are accumulated into
chunk-sized buffers and handed off to the transcription pipeline.
"""

import asyncio
import io
import wave
import pyaudio

# ── Constants ────────────────────────────────────────────────────────────────
SAMPLE_RATE   = 16_000   # Whisper's native rate
CHANNELS      = 1        # Mono
FORMAT        = pyaudio.paInt16
CHUNK_FRAMES  = 1_024    # ~64 ms per read
CHUNK_SECONDS = 4        # Accumulate this many seconds before transcribing


class MicrophoneCapture:
    """
    Non-blocking ring-buffer mic capture.

    Usage (inside an async context):
        async for wav_bytes in MicrophoneCapture():
            await transcribe(wav_bytes)
    """

    def __init__(self, device_index: int | None = None):
        self._pa           = pyaudio.PyAudio()
        self._device_index = device_index
        self._stream       = None
        self._active       = False

    # ── Context manager ───────────────────────────────────────────────────
    def __enter__(self):
        self._stream = self._pa.open(
            format            = FORMAT,
            channels          = CHANNELS,
            rate              = SAMPLE_RATE,
            input             = True,
            input_device_index= self._device_index,
            frames_per_buffer = CHUNK_FRAMES,
        )
        self._active = True
        return self

    def __exit__(self, *_):
        self.stop()

    def stop(self):
        self._active = False
        if self._stream:
            self._stream.stop_stream()
            self._stream.close()
        self._pa.terminate()

    # ── Async generator ───────────────────────────────────────────────────
    async def stream_wav_chunks(self):
        """
        Yields WAV-encoded bytes every CHUNK_SECONDS seconds.
        Runs PyAudio reads in an executor to avoid blocking the event loop.
        """
        loop         = asyncio.get_running_loop()
        target_frames = SAMPLE_RATE * CHUNK_SECONDS
        raw_frames    = []
        accumulated   = 0

        while self._active:
            # Offload the blocking read to a thread-pool worker
            data = await loop.run_in_executor(
                None,
                self._stream.read,
                CHUNK_FRAMES,
                False,  # exception_on_overflow=False
            )
            raw_frames.append(data)
            accumulated += CHUNK_FRAMES

            if accumulated >= target_frames:
                yield _frames_to_wav(raw_frames)
                raw_frames  = []
                accumulated = 0


def _frames_to_wav(frames: list[bytes]) -> bytes:
    """Pack raw PCM frames into an in-memory WAV file."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(pyaudio.get_sample_size(FORMAT))
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(b"".join(frames))
    return buf.getvalue()


def list_input_devices() -> list[dict]:
    """Utility: list available input devices for diagnostic output."""
    pa      = pyaudio.PyAudio()
    devices = []
    for i in range(pa.get_device_count()):
        info = pa.get_device_info_by_index(i)
        if info["maxInputChannels"] > 0:
            devices.append({"index": i, "name": info["name"]})
    pa.terminate()
    return devices
