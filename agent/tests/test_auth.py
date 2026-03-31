"""Tests for the authentication module.

Tests cover the full auth lifecycle: user creation with PBKDF2 hashing,
duplicate detection, login verification, first-boot detection, and
input validation. Uses temporary SQLite databases to ensure isolation.
"""

import os
import tempfile

import pytest

from agent.auth import AuthStore, UserExistsError


@pytest.fixture
def auth_store():
    """Create an AuthStore backed by a temporary SQLite database."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    store = AuthStore(db_path=path)
    yield store
    os.unlink(path)


class TestAuthStore:
    """Tests for AuthStore user management."""

    def test_no_users_initially(self, auth_store):
        assert auth_store.has_users() is False

    def test_create_user(self, auth_store):
        auth_store.create_user("alice", "password123")
        assert auth_store.has_users() is True

    def test_authenticate_valid(self, auth_store):
        auth_store.create_user("alice", "password123")
        assert auth_store.authenticate("alice", "password123") is True

    def test_authenticate_wrong_password(self, auth_store):
        auth_store.create_user("alice", "password123")
        assert auth_store.authenticate("alice", "wrongpassword") is False

    def test_authenticate_nonexistent_user(self, auth_store):
        assert auth_store.authenticate("nobody", "password123") is False

    def test_duplicate_user_raises(self, auth_store):
        auth_store.create_user("alice", "password123")
        with pytest.raises(UserExistsError):
            auth_store.create_user("alice", "different_password")

    def test_list_users(self, auth_store):
        assert auth_store.list_users() == []
        auth_store.create_user("alice", "pass1")
        auth_store.create_user("bob", "pass2")
        users = auth_store.list_users()
        assert "alice" in users
        assert "bob" in users
        assert len(users) == 2

    def test_multiple_users_independent(self, auth_store):
        auth_store.create_user("alice", "pass_alice")
        auth_store.create_user("bob", "pass_bob")
        assert auth_store.authenticate("alice", "pass_alice") is True
        assert auth_store.authenticate("bob", "pass_bob") is True
        assert auth_store.authenticate("alice", "pass_bob") is False
        assert auth_store.authenticate("bob", "pass_alice") is False

    def test_password_hash_uses_salt(self, auth_store):
        """Each hash should use a unique random salt."""
        hash1 = auth_store._hash_password("same_password")
        hash2 = auth_store._hash_password("same_password")
        # Different salts produce different stored strings
        assert hash1 != hash2
        # But both verify correctly
        assert auth_store._verify_password("same_password", hash1) is True
        assert auth_store._verify_password("same_password", hash2) is True

    def test_password_hash_format(self, auth_store):
        """Hash format should be 'salt_hex:hash_hex'."""
        h = auth_store._hash_password("test")
        parts = h.split(":")
        assert len(parts) == 2
        # Salt is 16 bytes = 32 hex chars
        assert len(parts[0]) == 32
        # SHA256 output is 32 bytes = 64 hex chars
        assert len(parts[1]) == 64

    def test_empty_username_raises(self, auth_store):
        with pytest.raises(ValueError, match="Username cannot be empty"):
            auth_store.create_user("", "password123")

    def test_whitespace_username_raises(self, auth_store):
        with pytest.raises(ValueError, match="Username cannot be empty"):
            auth_store.create_user("   ", "password123")

    def test_short_password_raises(self, auth_store):
        with pytest.raises(ValueError, match="at least 4 characters"):
            auth_store.create_user("alice", "ab")

    def test_empty_password_raises(self, auth_store):
        with pytest.raises(ValueError, match="at least 4 characters"):
            auth_store.create_user("alice", "")

    def test_username_stripped(self, auth_store):
        auth_store.create_user("  alice  ", "password123")
        assert auth_store.authenticate("alice", "password123") is True

    def test_persistence_across_instances(self, auth_store):
        """Data survives creating a new AuthStore instance on the same db."""
        auth_store.create_user("alice", "password123")
        store2 = AuthStore(db_path=auth_store.db_path)
        assert store2.has_users() is True
        assert store2.authenticate("alice", "password123") is True


class TestAuthTokens:
    """Tests for session token management - the mechanism that enables
    'stay logged in until explicit logout' across app restarts."""

    def test_create_and_verify_token(self, auth_store):
        auth_store.create_user("alice", "password123")
        token = auth_store.create_token("alice")
        assert isinstance(token, str)
        assert len(token) == 64  # 32 bytes = 64 hex chars
        assert auth_store.verify_token(token) == "alice"

    def test_verify_invalid_token(self, auth_store):
        assert auth_store.verify_token("nonexistent_token") is None

    def test_revoke_token(self, auth_store):
        auth_store.create_user("alice", "password123")
        token = auth_store.create_token("alice")
        assert auth_store.verify_token(token) == "alice"
        assert auth_store.revoke_token(token) is True
        assert auth_store.verify_token(token) is None

    def test_revoke_nonexistent_token(self, auth_store):
        assert auth_store.revoke_token("no_such_token") is False

    def test_multiple_tokens_per_user(self, auth_store):
        """A user can have multiple active sessions (e.g. different devices)."""
        auth_store.create_user("alice", "password123")
        token1 = auth_store.create_token("alice")
        token2 = auth_store.create_token("alice")
        assert token1 != token2
        assert auth_store.verify_token(token1) == "alice"
        assert auth_store.verify_token(token2) == "alice"

    def test_revoke_all_tokens(self, auth_store):
        auth_store.create_user("alice", "password123")
        auth_store.create_token("alice")
        auth_store.create_token("alice")
        count = auth_store.revoke_all_tokens("alice")
        assert count == 2

    def test_revoke_all_tokens_no_tokens(self, auth_store):
        auth_store.create_user("alice", "password123")
        assert auth_store.revoke_all_tokens("alice") == 0

    def test_token_persists_across_instances(self, auth_store):
        """Token survives creating a new AuthStore on the same db - this is the
        core property that enables session persistence across app restarts."""
        auth_store.create_user("alice", "password123")
        token = auth_store.create_token("alice")
        store2 = AuthStore(db_path=auth_store.db_path)
        assert store2.verify_token(token) == "alice"

    def test_revoking_one_token_preserves_others(self, auth_store):
        auth_store.create_user("alice", "password123")
        token1 = auth_store.create_token("alice")
        token2 = auth_store.create_token("alice")
        auth_store.revoke_token(token1)
        assert auth_store.verify_token(token1) is None
        assert auth_store.verify_token(token2) == "alice"

    def test_tokens_scoped_to_user(self, auth_store):
        """Revoking all tokens for one user doesn't affect another's."""
        auth_store.create_user("alice", "pass1")
        auth_store.create_user("bob", "pass2")
        auth_store.create_token("alice")
        bob_token = auth_store.create_token("bob")
        auth_store.revoke_all_tokens("alice")
        assert auth_store.verify_token(bob_token) == "bob"


class TestAuthAPI:
    """Tests for the auth API routes in FastAPI."""

    @pytest.fixture
    def client(self, tmp_path):
        """Create a test client with a temporary database."""
        db_path = str(tmp_path / "test_auth.db")
        os.environ["MONET_DB_PATH"] = db_path

        # Import after setting env var so the module picks it up
        from fastapi.testclient import TestClient
        from agent.main import app, auth_store as app_auth_store

        # Point the app's auth store at our temp db
        app_auth_store.__init__(db_path=db_path)

        yield TestClient(app)

    def test_auth_status_no_users(self, client):
        resp = client.get("/api/auth/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["has_users"] is False
        assert data["users"] == []

    def test_create_user_via_api(self, client):
        resp = client.post(
            "/api/auth/create",
            json={"username": "alice", "password": "password123"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "created"
        assert data["username"] == "alice"

    def test_auth_status_after_create(self, client):
        client.post(
            "/api/auth/create",
            json={"username": "alice", "password": "password123"},
        )
        resp = client.get("/api/auth/status")
        data = resp.json()
        assert data["has_users"] is True
        assert "alice" in data["users"]

    def test_login_success(self, client):
        client.post(
            "/api/auth/create",
            json={"username": "alice", "password": "password123"},
        )
        resp = client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "password123"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["authenticated"] is True
        assert data["username"] == "alice"

    def test_login_wrong_password(self, client):
        client.post(
            "/api/auth/create",
            json={"username": "alice", "password": "password123"},
        )
        resp = client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "wrong"},
        )
        assert resp.status_code == 401
        data = resp.json()
        assert data["detail"] == "Invalid username or password"

    def test_login_nonexistent_user(self, client):
        resp = client.post(
            "/api/auth/login",
            json={"username": "nobody", "password": "password123"},
        )
        assert resp.status_code == 401

    def test_create_duplicate_user(self, client):
        client.post(
            "/api/auth/create",
            json={"username": "alice", "password": "password123"},
        )
        resp = client.post(
            "/api/auth/create",
            json={"username": "alice", "password": "other"},
        )
        assert resp.status_code == 409
        assert "already exists" in resp.json()["detail"]

    def test_create_user_invalid_input(self, client):
        resp = client.post(
            "/api/auth/create",
            json={"username": "", "password": "password123"},
        )
        assert resp.status_code == 400

        resp = client.post(
            "/api/auth/create",
            json={"username": "alice", "password": "ab"},
        )
        assert resp.status_code == 400

    def test_login_returns_token(self, client):
        """Login should return a session token for persistent auth."""
        client.post(
            "/api/auth/create",
            json={"username": "alice", "password": "password123"},
        )
        resp = client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "password123"},
        )
        data = resp.json()
        assert "token" in data
        assert len(data["token"]) == 64

    def test_create_user_returns_token(self, client):
        """Account creation should auto-issue a session token."""
        resp = client.post(
            "/api/auth/create",
            json={"username": "alice", "password": "password123"},
        )
        data = resp.json()
        assert "token" in data
        assert len(data["token"]) == 64

    def test_verify_valid_token(self, client):
        resp = client.post(
            "/api/auth/create",
            json={"username": "alice", "password": "password123"},
        )
        token = resp.json()["token"]
        resp = client.get(f"/api/auth/verify?token={token}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["authenticated"] is True
        assert data["username"] == "alice"

    def test_verify_invalid_token(self, client):
        resp = client.get("/api/auth/verify?token=bogus_token")
        assert resp.status_code == 401

    def test_logout_revokes_token(self, client):
        resp = client.post(
            "/api/auth/create",
            json={"username": "alice", "password": "password123"},
        )
        token = resp.json()["token"]
        # Logout
        resp = client.post(f"/api/auth/logout?token={token}")
        assert resp.status_code == 200
        assert resp.json()["status"] == "logged_out"
        # Token should now be invalid
        resp = client.get(f"/api/auth/verify?token={token}")
        assert resp.status_code == 401

    def test_logout_invalid_token(self, client):
        resp = client.post("/api/auth/logout?token=no_such_token")
        assert resp.status_code == 404
