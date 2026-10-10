"""Demo authentication: hashed passwords, server-side sessions, CSRF tokens.

This is hackathon demo auth, not enterprise SSO. Identity and role always come from the
server-side session; nothing in a request body can choose who the actor is.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from ..core.data import ReferenceData
from .store import Store, utc_now

ROLES = ("coordinator", "clinical_lead", "physician")
PBKDF2_ITERATIONS = 120_000


@dataclass(frozen=True)
class Identity:
    username: str
    display_name: str
    role: str
    physician_id: str | None
    csrf_token: str

    def public(self) -> dict:
        return {"username": self.username, "display_name": self.display_name, "role": self.role,
                "physician_id": self.physician_id}


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iterations, salt_hex, digest_hex = stored.split("$")
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iterations))
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def demo_accounts(ref: ReferenceData) -> list[dict]:
    accounts = [
        {"username": "coordinator", "display_name": "Operations Coordinator", "role": "coordinator",
         "physician_id": None},
        {"username": "lead", "display_name": "Clinical Lead on Duty", "role": "clinical_lead",
         "physician_id": None},
    ]
    for pid, phy in sorted(ref.physicians.items()):
        if not phy.on_roster_shift:
            accounts.append({"username": pid.lower(), "display_name": phy.name, "role": "physician",
                             "physician_id": pid})
    return accounts


def seed_users(store: Store, ref: ReferenceData, password: str) -> None:
    """Create or refresh demo accounts. Password comes from server configuration only."""
    with store.tx() as conn:
        for acct in demo_accounts(ref):
            row = conn.execute("SELECT password_hash FROM users WHERE username=?", (acct["username"],)).fetchone()
            if row and verify_password(password, row["password_hash"]):
                continue
            conn.execute(
                "INSERT INTO users(username, display_name, role, physician_id, password_hash) VALUES (?,?,?,?,?) "
                "ON CONFLICT(username) DO UPDATE SET display_name=excluded.display_name, role=excluded.role, "
                "physician_id=excluded.physician_id, password_hash=excluded.password_hash",
                (acct["username"], acct["display_name"], acct["role"], acct["physician_id"], hash_password(password)),
            )


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def login(store: Store, username: str, password: str, session_hours: float) -> tuple[str, Identity] | None:
    with store.read() as conn:
        user = conn.execute("SELECT * FROM users WHERE username=?", (username.strip().lower(),)).fetchone()
    if user is None or not verify_password(password, user["password_hash"]):
        return None
    token = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(24)
    expires = datetime.now(timezone.utc) + timedelta(hours=session_hours)
    with store.tx() as conn:
        conn.execute("INSERT INTO sessions(token_hash, username, csrf_token, created_at, expires_at) VALUES (?,?,?,?,?)",
                     (_token_hash(token), user["username"], csrf, utc_now(), expires.isoformat()))
    return token, Identity(user["username"], user["display_name"], user["role"], user["physician_id"], csrf)


def resolve(store: Store, token: str | None) -> Identity | None:
    if not token:
        return None
    with store.read() as conn:
        row = conn.execute(
            "SELECT s.csrf_token, s.expires_at, s.revoked, u.* FROM sessions s JOIN users u USING(username) "
            "WHERE s.token_hash=?", (_token_hash(token),)).fetchone()
    if row is None or row["revoked"]:
        return None
    if datetime.fromisoformat(row["expires_at"]) <= datetime.now(timezone.utc):
        return None
    return Identity(row["username"], row["display_name"], row["role"], row["physician_id"], row["csrf_token"])


def logout(store: Store, token: str | None) -> None:
    if not token:
        return
    with store.tx() as conn:
        conn.execute("UPDATE sessions SET revoked=1 WHERE token_hash=?", (_token_hash(token),))


def purge_expired(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (datetime.now(timezone.utc).isoformat(),))
