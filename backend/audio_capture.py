"""
audio_capture.py — Real-time microphone sniffing with sounddevice.

sounddevice ships pre-built CFFI wheels and does not require portaudio19-dev
at compile time (it links against the shared libportaudio at runtime, which
ships inside the wheel on Linux x86_64).

Produces a continuous stream of raw PCM frames accumulated into
chunk-sized WAV buffers and handed off to the transcription pipeline.
"""

import asyncio
import io
import queue
import wave
import numpy as np
# sounddevice is imported lazily inside MicrophoneCapture.__enter__ so that
# the FastAPI server can start and serve HTTP/WebSocket endpoints even on
# systems where libportaudio.so is not yet installed.

# ── Constants ────────────────────────────────────────────────────────────────
SAMPLE_RATE   = 16_000   # Whisper's native rate
CHANNELS      = 1        # Mono
DTYPE         = "int16"
CHUNK_FRAMES  = 1_024    # ~64 ms per read
CHUNK_SECONDS = 4        # Accumulate N seconds before sending to Whisper


class MicrophoneCapture:
    """
    Non-blocking mic capture via sounddevice.

    Usage (async context):
        mic = MicrophoneCapture()
        with mic:
            async for wav_bytes in mic.stream_wav_chunks():
                await process(wav_bytes)
    """

    def __init__(self, device_index: int | None = None):
        self._device_index = device_index
        self._queue: queue.Queue[np.ndarray] = queue.Queue()
        self._stream = None
        self._active = False

    # ── Context manager ───────────────────────────────────────────────────
    def __enter__(self):
        try:
            import sounddevice as sd
        except OSError as exc:
            raise RuntimeError(
                "PortAudio library not found. "
                "Install with: sudo apt install libportaudio2 portaudio19-dev"
            ) from exc
        self._sd = sd
        self._active = True
        self._stream = sd.InputStream(
            samplerate = SAMPLE_RATE,
            channels   = CHANNELS,
            dtype      = DTYPE,
            blocksize  = CHUNK_FRAMES,
            device     = self._device_index,
            callback   = self._callback,
        )
        self._stream.start()
        return self

    def __exit__(self, *_):
        self.stop()

    def stop(self):
        self._active = False
        if self._stream:
            self._stream.stop()
            self._stream.close()
            self._stream = None

    def _callback(self, indata: np.ndarray, frames: int, time_info, status):
        """sounddevice callback — runs in a C thread, just enqueue the copy."""
        if self._active:
            self._queue.put(indata.copy())

    # ── Async generator ───────────────────────────────────────────────────
    async def stream_wav_chunks(self):
        """
        Yields WAV-encoded bytes every CHUNK_SECONDS seconds.
        Drains the queue asynchronously without blocking the event loop.
        """
        loop          = asyncio.get_running_loop()
        target_frames = SAMPLE_RATE * CHUNK_SECONDS
        accumulated   = []
        total_frames  = 0

        while self._active:
            # Non-blocking drain — sleep briefly if queue is empty
            try:
                block = self._queue.get_nowait()
                accumulated.append(block)
                total_frames += len(block)
            except queue.Empty:
                await asyncio.sleep(0.02)
                continue

            if total_frames >= target_frames:
                pcm = np.concatenate(accumulated, axis=0)
                yield _numpy_to_wav(pcm)
                accumulated  = []
                total_frames = 0


def _numpy_to_wav(pcm: np.ndarray) -> bytes:
    """Pack a (N, 1) int16 numpy array into an in-memory WAV file."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(2)           # int16 = 2 bytes
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(pcm.tobytes())
    return buf.getvalue()


def list_input_devices() -> list[dict]:
    """Utility: list available input devices."""
    try:
        import sounddevice as sd
        devices = []
        for i, d in enumerate(sd.query_devices()):
            if d["max_input_channels"] > 0:
                devices.append({"index": i, "name": d["name"]})
        return devices
    except OSError:
        return [{"index": -1, "name": "PortAudio unavailable — install libportaudio2"}]
