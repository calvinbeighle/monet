"""Authentication module - SQLite user store with password hashing and session tokens.

Provides first-boot user creation, login, and persistent session tokens for the
Monet OS. Passwords are hashed with PBKDF2-HMAC-SHA256 (100k iterations) and
stored as salt:hash in SQLite. Session tokens are cryptographically random 32-byte
hex strings stored alongside the username they belong to. Tokens persist until
explicit logout or revocation - this is what enables "stay logged in until logout."
"""

import hashlib
import logging
import os
import secrets
import sqlite3

logger = logging.getLogger(__name__)

PBKDF2_ITERATIONS = 100_000
SALT_BYTES = 16
TOKEN_BYTES = 32


class UserExistsError(Exception):
    """Raised when attempting to create a user that already exists."""


class AuthStore:
    """SQLite-backed user authentication store with persistent session tokens."""

    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self._init_db()

    def _init_db(self) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """CREATE TABLE IF NOT EXISTS users (
                    username TEXT PRIMARY KEY,
                    password_hash TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )"""
            )
            conn.execute(
                """CREATE TABLE IF NOT EXISTS auth_tokens (
                    token TEXT PRIMARY KEY,
                    username TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (username) REFERENCES users(username)
                )"""
            )
            conn.commit()

    def _hash_password(self, password: str, salt: bytes | None = None) -> str:
        """Hash a password with PBKDF2-HMAC-SHA256. Returns 'salt_hex:hash_hex'."""
        if salt is None:
            salt = secrets.token_bytes(SALT_BYTES)
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS
        )
        return f"{salt.hex()}:{dk.hex()}"

    def _verify_password(self, password: str, stored_hash: str) -> bool:
        """Verify a password against a stored salt:hash string."""
        salt_hex, _ = stored_hash.split(":", 1)
        salt = bytes.fromhex(salt_hex)
        return self._hash_password(password, salt) == stored_hash

    def has_users(self) -> bool:
        """Check if any user exists (for first-boot detection)."""
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute("SELECT 1 FROM users LIMIT 1").fetchone()
            return row is not None

    def create_user(self, username: str, password: str) -> None:
        """Create a new user. Raises UserExistsError if username is taken."""
        if not username or not username.strip():
            raise ValueError("Username cannot be empty")
        if not password or len(password) < 4:
            raise ValueError("Password must be at least 4 characters")

        password_hash = self._hash_password(password)
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (username.strip(), password_hash),
                )
                conn.commit()
        except sqlite3.IntegrityError:
            raise UserExistsError(f"User '{username}' already exists")

        logger.info("Created user: %s", username)

    def authenticate(self, username: str, password: str) -> bool:
        """Verify username and password. Returns True if valid."""
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT password_hash FROM users WHERE username = ?",
                (username,),
            ).fetchone()
            if row is None:
                return False
            return self._verify_password(password, row[0])

    def list_users(self) -> list[str]:
        """List all usernames."""
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                "SELECT username FROM users ORDER BY created_at"
            ).fetchall()
            return [row[0] for row in rows]

    def create_token(self, username: str) -> str:
        """Create a persistent session token for a user. Returns the token string."""
        token = secrets.token_hex(TOKEN_BYTES)
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO auth_tokens (token, username) VALUES (?, ?)",
                (token, username),
            )
            conn.commit()
        logger.info("Created session token for user: %s", username)
        return token

    def verify_token(self, token: str) -> str | None:
        """Verify a session token. Returns the username if valid, None otherwise."""
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT username FROM auth_tokens WHERE token = ?",
                (token,),
            ).fetchone()
            return row[0] if row else None

    def revoke_token(self, token: str) -> bool:
        """Revoke a session token. Returns True if a token was actually deleted."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute("DELETE FROM auth_tokens WHERE token = ?", (token,))
            conn.commit()
            return cursor.rowcount > 0

    def revoke_all_tokens(self, username: str) -> int:
        """Revoke all session tokens for a user. Returns count of tokens revoked."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                "DELETE FROM auth_tokens WHERE username = ?", (username,)
            )
            conn.commit()
            return cursor.rowcount
