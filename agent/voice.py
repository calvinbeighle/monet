"""Voice transcription via OpenAI Whisper API."""

import logging
import os

import httpx

logger = logging.getLogger(__name__)

WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions"
WHISPER_MODEL = "whisper-1"
MAX_AUDIO_SIZE = 25 * 1024 * 1024  # 25 MB Whisper limit


def get_openai_key() -> str | None:
    """Return the OpenAI API key from environment, or None."""
    return os.environ.get("OPENAI_API_KEY")


async def transcribe_audio(
    audio_bytes: bytes,
    filename: str = "recording.wav",
    language: str | None = None,
) -> str:
    """Transcribe audio bytes via OpenAI Whisper API.

    Returns the transcribed text string.
    Raises ValueError if no API key is configured.
    Raises RuntimeError if the Whisper API call fails.
    """
    api_key = get_openai_key()
    if not api_key:
        raise ValueError("OPENAI_API_KEY environment variable is not set")

    if len(audio_bytes) == 0:
        raise ValueError("Empty audio data")

    if len(audio_bytes) > MAX_AUDIO_SIZE:
        raise ValueError(
            f"Audio file too large ({len(audio_bytes)} bytes, max {MAX_AUDIO_SIZE})"
        )

    # Determine content type from filename
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "wav"
    content_types = {
        "wav": "audio/wav",
        "mp3": "audio/mpeg",
        "mp4": "audio/mp4",
        "m4a": "audio/mp4",
        "webm": "audio/webm",
        "ogg": "audio/ogg",
        "flac": "audio/flac",
    }
    content_type = content_types.get(ext, "audio/wav")

    data = {"model": WHISPER_MODEL, "response_format": "text"}
    if language:
        data["language"] = language

    files = {"file": (filename, audio_bytes, content_type)}

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.post(
                WHISPER_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                data=data,
                files=files,
            )
        except httpx.RequestError as e:
            logger.error("Whisper API request failed: %s", e)
            raise RuntimeError(f"Failed to reach Whisper API: {e}") from e

        if resp.status_code != 200:
            logger.error(
                "Whisper API returned %d: %s", resp.status_code, resp.text[:200]
            )
            raise RuntimeError(
                f"Whisper API error ({resp.status_code}): {resp.text[:200]}"
            )

        return resp.text.strip()
