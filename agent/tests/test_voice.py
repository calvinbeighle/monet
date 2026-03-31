"""Tests for agent.voice - Whisper API transcription."""

import os
from unittest.mock import AsyncMock, patch, MagicMock

import pytest

from agent.voice import transcribe_audio, get_openai_key, WHISPER_URL, MAX_AUDIO_SIZE


class TestGetOpenaiKey:
    def test_returns_key_when_set(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test-123")
        assert get_openai_key() == "sk-test-123"

    def test_returns_none_when_unset(self, monkeypatch):
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        assert get_openai_key() is None


class TestTranscribeAudio:
    @pytest.mark.asyncio
    async def test_raises_without_api_key(self, monkeypatch):
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        with pytest.raises(ValueError, match="OPENAI_API_KEY"):
            await transcribe_audio(b"audio data")

    @pytest.mark.asyncio
    async def test_raises_on_empty_audio(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        with pytest.raises(ValueError, match="Empty audio data"):
            await transcribe_audio(b"")

    @pytest.mark.asyncio
    async def test_raises_on_oversized_audio(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        big_data = b"x" * (MAX_AUDIO_SIZE + 1)
        with pytest.raises(ValueError, match="too large"):
            await transcribe_audio(big_data)

    @pytest.mark.asyncio
    async def test_successful_transcription(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = "Hello world"

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("agent.voice.httpx.AsyncClient", return_value=mock_client):
            result = await transcribe_audio(b"fake audio", filename="test.wav")

        assert result == "Hello world"
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[0][0] == WHISPER_URL
        assert "Bearer sk-test" in call_args[1]["headers"]["Authorization"]

    @pytest.mark.asyncio
    async def test_strips_whitespace_from_result(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = "  Hello world  \n"

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("agent.voice.httpx.AsyncClient", return_value=mock_client):
            result = await transcribe_audio(b"fake audio")

        assert result == "Hello world"

    @pytest.mark.asyncio
    async def test_api_error_raises_runtime(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

        mock_response = MagicMock()
        mock_response.status_code = 400
        mock_response.text = "Bad request: invalid audio format"

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("agent.voice.httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(RuntimeError, match="Whisper API error"):
                await transcribe_audio(b"fake audio")

    @pytest.mark.asyncio
    async def test_network_error_raises_runtime(self, monkeypatch):
        import httpx as httpx_mod

        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(
            side_effect=httpx_mod.ConnectError("connection refused")
        )
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("agent.voice.httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(RuntimeError, match="Failed to reach Whisper API"):
                await transcribe_audio(b"fake audio")

    @pytest.mark.asyncio
    async def test_language_param_passed(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = "Bonjour"

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("agent.voice.httpx.AsyncClient", return_value=mock_client):
            result = await transcribe_audio(b"audio", language="fr")

        assert result == "Bonjour"
        call_data = mock_client.post.call_args[1]["data"]
        assert call_data["language"] == "fr"

    @pytest.mark.asyncio
    async def test_content_type_detection(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = "test"

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("agent.voice.httpx.AsyncClient", return_value=mock_client):
            await transcribe_audio(b"audio", filename="test.mp3")

        call_files = mock_client.post.call_args[1]["files"]
        assert call_files["file"][2] == "audio/mpeg"

    @pytest.mark.asyncio
    async def test_default_filename(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = "test"

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("agent.voice.httpx.AsyncClient", return_value=mock_client):
            await transcribe_audio(b"audio")

        call_files = mock_client.post.call_args[1]["files"]
        assert call_files["file"][0] == "recording.wav"


class TestVoiceEndpoint:
    """Tests for the /api/voice/* endpoints via FastAPI TestClient."""

    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient
        from agent.main import app

        return TestClient(app)

    def test_transcribe_no_api_key(self, client, monkeypatch):
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        resp = client.post(
            "/api/voice/transcribe",
            files={"file": ("test.wav", b"audio data", "audio/wav")},
        )
        assert resp.status_code == 503

    def test_transcribe_empty_file(self, client, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        resp = client.post(
            "/api/voice/transcribe",
            files={"file": ("test.wav", b"", "audio/wav")},
        )
        assert resp.status_code == 400

    def test_transcribe_success(self, client, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

        async def mock_transcribe(audio_bytes, filename="recording.wav"):
            return "Hello from voice"

        with patch("agent.main.transcribe_audio", side_effect=mock_transcribe):
            resp = client.post(
                "/api/voice/transcribe",
                files={"file": ("test.wav", b"audio data", "audio/wav")},
            )

        assert resp.status_code == 200
        assert resp.json()["text"] == "Hello from voice"

    def test_transcribe_whisper_error(self, client, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

        async def mock_transcribe(audio_bytes, filename="recording.wav"):
            raise RuntimeError("Whisper API error (500)")

        with patch("agent.main.transcribe_audio", side_effect=mock_transcribe):
            resp = client.post(
                "/api/voice/transcribe",
                files={"file": ("test.wav", b"audio", "audio/wav")},
            )

        assert resp.status_code == 502

    def test_voice_status_available(self, client, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        resp = client.get("/api/voice/status")
        assert resp.status_code == 200
        assert resp.json()["available"] is True

    def test_voice_status_unavailable(self, client, monkeypatch):
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        resp = client.get("/api/voice/status")
        assert resp.status_code == 200
        assert resp.json()["available"] is False
