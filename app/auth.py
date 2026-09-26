"""SuryaJal - optional user accounts: sign up, sign in, sign out and "My roofs".

Guests can use every feature; an account only adds a saved list of roofs.

* Storage   one SQLite file (data/suryajal.db) - no database server needed.
* Passwords scrypt from the Python standard library (salted, memory-hard).
* Sessions  random 256-bit bearer tokens; only their SHA-256 is stored, so a
            leaked database file cannot be used to log in.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Dict, Iterator, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field

from .config import DATA_DIR

DB_PATH: Path = DATA_DIR / "suryajal.db"     # tests point this at a temp file
SESSION_DAYS = 30                           # "keep me signed in"
SHORT_SESSION_HOURS = 12                    # shared fest laptop: box unticked
MAX_ROOFS_PER_USER = 200
MAX_FAILS, FAIL_WINDOW_S = 8, 600           # 8 wrong passwords per 10 min per email

EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")
COMMON_PASSWORDS = {"password", "password1", "12345678", "123456789", "1234567890", "qwerty123",
                    "11111111", "iloveyou", "abcd1234", "suryajal", "letmein1", "00000000"}
_SCRYPT = {"n": 2 ** 14, "r": 8, "p": 5, "dklen": 32}   # OWASP-equivalent setting, 16 MiB

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name        TEXT NOT NULL,
    pw_hash     TEXT NOT NULL,
    created_at  REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  REAL NOT NULL,
    expires_at  REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS roofs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    roof_key    TEXT NOT NULL,
    query       TEXT NOT NULL,
    title       TEXT NOT NULL,
    summary     TEXT NOT NULL,
    created_at  REAL NOT NULL,
    updated_at  REAL NOT NULL,
    UNIQUE(user_id, roof_key)
);
CREATE INDEX IF NOT EXISTS ix_roofs_user ON roofs(user_id, updated_at DESC);
"""

_init_lock = threading.Lock()
_ready_for: Optional[Path] = None
_fails: Dict[str, List[float]] = {}
_fails_lock = threading.Lock()


# ------------------------------------------------------------------ database
def init_db() -> None:
    global _ready_for
    if _ready_for == DB_PATH:
        return
    with _init_lock:
        if _ready_for == DB_PATH:
            return
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        con = sqlite3.connect(DB_PATH)
        try:
            con.execute("PRAGMA journal_mode=WAL")
            con.executescript(SCHEMA)
            con.commit()
        finally:
            con.close()
        _ready_for = DB_PATH


@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    init_db()
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    try:
        yield con
        con.commit()
    finally:
        con.close()


# ------------------------------------------------------------------ passwords + tokens
def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(pw.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${_SCRYPT['n']}${_SCRYPT['r']}${_SCRYPT['p']}${_b64(salt)}${_b64(dk)}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, dk = stored.split("$")
        if algo != "scrypt":
            return False
        want = _unb64(dk)
        got = hashlib.scrypt(pw.encode(), salt=_unb64(salt), n=int(n), r=int(r), p=int(p),
                             dklen=len(want))
        return hmac.compare_digest(got, want)
    except Exception:
        return False


_DUMMY_HASH = hash_password(secrets.token_hex(8))   # equal timing for unknown emails


def _token_hash(tok: str) -> str:
    return hashlib.sha256(tok.encode()).hexdigest()


def _new_session(con: sqlite3.Connection, user_id: int, remember: bool) -> Dict:
    tok = secrets.token_urlsafe(32)
    now = time.time()
    exp = now + (SESSION_DAYS * 86400 if remember else SHORT_SESSION_HOURS * 3600)
    con.execute("INSERT INTO sessions(token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)",
                (_token_hash(tok), user_id, now, exp))
    con.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
    return {"token": tok, "expires_at": exp}


def _user_dict(row) -> Dict:
    return {"id": row["id"], "email": row["email"], "name": row["name"],
            "created_at": row["created_at"]}


# ------------------------------------------------------------------ failed-login throttle
def _too_many(key: str) -> bool:
    now = time.time()
    with _fails_lock:
        recent = [t for t in _fails.get(key, []) if now - t < FAIL_WINDOW_S]
        _fails[key] = recent
        return len(recent) >= MAX_FAILS


def _note_fail(key: str) -> None:
    with _fails_lock:
        if len(_fails) > 5000:
            _fails.clear()
        _fails.setdefault(key, []).append(time.time())


# ------------------------------------------------------------------ dependencies
def _bearer(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    scheme, _, tok = authorization.partition(" ")
    tok = tok.strip()
    return tok if scheme.lower() == "bearer" and 20 <= len(tok) <= 200 else None


def optional_user(authorization: Optional[str] = Header(None)) -> Optional[Dict]:
    tok = _bearer(authorization)
    if not tok:
        return None
    with db() as con:
        row = con.execute(
            "SELECT u.id, u.email, u.name, u.created_at FROM sessions s "
            "JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?",
            (_token_hash(tok), time.time())).fetchone()
    return _user_dict(row) if row else None


def current_user(user: Optional[Dict] = Depends(optional_user)) -> Dict:
    if user is None:
        raise HTTPException(401, "Please sign in first.", headers={"WWW-Authenticate": "Bearer"})
    return user


# ------------------------------------------------------------------ saved roofs
def _roof_dict(row) -> Dict:
    return {"id": row["id"], "title": row["title"], "query": row["query"],
            "summary": json.loads(row["summary"]), "created_at": row["created_at"],
            "updated_at": row["updated_at"]}


def list_roofs(user_id: int) -> List[Dict]:
    with db() as con:
        rows = con.execute("SELECT * FROM roofs WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?",
                           (user_id, MAX_ROOFS_PER_USER)).fetchall()
    return [_roof_dict(r) for r in rows]


def save_roof(user_id: int, roof_key: str, query: str, title: str, summary: Dict) -> Dict:
    """Insert, or update the entry for the same roof outline (one card per roof)."""
    now = time.time()
    key = hashlib.sha1(roof_key.encode()).hexdigest()
    with db() as con:
        n = con.execute("SELECT COUNT(*) FROM roofs WHERE user_id = ?", (user_id,)).fetchone()[0]
        exists = con.execute("SELECT id FROM roofs WHERE user_id = ? AND roof_key = ?",
                             (user_id, key)).fetchone()
        if not exists and n >= MAX_ROOFS_PER_USER:
            raise HTTPException(409, f"You can save up to {MAX_ROOFS_PER_USER} roofs - delete a few first.")
        con.execute(
            "INSERT INTO roofs(user_id, roof_key, query, title, summary, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id, roof_key) DO UPDATE SET "
            "query = excluded.query, title = excluded.title, summary = excluded.summary, "
            "updated_at = excluded.updated_at",
            (user_id, key, query, title, json.dumps(summary), now, now))
        row = con.execute("SELECT * FROM roofs WHERE user_id = ? AND roof_key = ?",
                          (user_id, key)).fetchone()
    return {**_roof_dict(row), "updated": bool(exists)}


def delete_roof(user_id: int, roof_id: int) -> bool:
    with db() as con:
        cur = con.execute("DELETE FROM roofs WHERE id = ? AND user_id = ?", (roof_id, user_id))
    return cur.rowcount > 0


# ------------------------------------------------------------------ routes
router = APIRouter(prefix="/api/auth", tags=["auth"])


class SignupIn(BaseModel):
    name: str = Field("", max_length=200)
    email: str = Field(..., max_length=320)
    password: str = Field(..., max_length=256)


class LoginIn(BaseModel):
    email: str = Field(..., max_length=320)
    password: str = Field(..., max_length=256)
    remember: bool = True


class DeleteIn(BaseModel):
    password: str = Field(..., max_length=256)


def _clean_email(raw: str) -> str:
    email = raw.strip().lower()
    if not EMAIL_RE.match(email) or len(email) > 254:
        raise HTTPException(422, "Please enter a valid email address.")
    return email


@router.post("/signup", status_code=201)
def signup(body: SignupIn):
    email = _clean_email(body.email)
    name = " ".join(body.name.split())[:60] or email.split("@")[0][:60]
    pw = body.password
    if len(pw) < 8:
        raise HTTPException(422, "Password must be at least 8 characters.")
    if pw.lower() in COMMON_PASSWORDS or len(set(pw)) < 4:
        raise HTTPException(422, "That password is too easy to guess - try a short phrase.")
    pw_hash = hash_password(pw)
    with db() as con:
        try:
            cur = con.execute("INSERT INTO users(email, name, pw_hash, created_at) VALUES (?,?,?,?)",
                              (email, name, pw_hash, time.time()))
        except sqlite3.IntegrityError:
            raise HTTPException(409, "An account with this email already exists - sign in instead.")
        uid = cur.lastrowid
        sess = _new_session(con, uid, True)
        row = con.execute("SELECT id, email, name, created_at FROM users WHERE id = ?", (uid,)).fetchone()
    return {**sess, "user": {**_user_dict(row), "roofs": 0}}


@router.post("/login")
def login(body: LoginIn):
    email = body.email.strip().lower()
    if _too_many(email):
        raise HTTPException(429, "Too many wrong attempts. Please wait 10 minutes and try again.")
    with db() as con:
        row = con.execute("SELECT id, email, name, created_at, pw_hash FROM users WHERE email = ?",
                          (email,)).fetchone()
        ok = verify_password(body.password, row["pw_hash"] if row else _DUMMY_HASH)
        if not (row and ok):
            _note_fail(email)
            raise HTTPException(401, "Wrong email or password.")
        sess = _new_session(con, row["id"], body.remember)
        n = con.execute("SELECT COUNT(*) FROM roofs WHERE user_id = ?", (row["id"],)).fetchone()[0]
    return {**sess, "user": {**_user_dict(row), "roofs": n}}


@router.post("/logout")
def logout(authorization: Optional[str] = Header(None),
           everywhere: bool = Query(False, description="sign out on all devices")):
    tok = _bearer(authorization)
    if tok:
        with db() as con:
            row = con.execute("SELECT user_id FROM sessions WHERE token_hash = ?",
                              (_token_hash(tok),)).fetchone()
            if row and everywhere:
                con.execute("DELETE FROM sessions WHERE user_id = ?", (row["user_id"],))
            else:
                con.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(tok),))
    return {"ok": True}


@router.get("/me")
def me(user: Dict = Depends(current_user)):
    with db() as con:
        n = con.execute("SELECT COUNT(*) FROM roofs WHERE user_id = ?", (user["id"],)).fetchone()[0]
    return {"user": {**user, "roofs": n}}


@router.delete("/me")
def delete_account(body: DeleteIn, user: Dict = Depends(current_user)):
    with db() as con:
        row = con.execute("SELECT pw_hash FROM users WHERE id = ?", (user["id"],)).fetchone()
        if not row or not verify_password(body.password, row["pw_hash"]):
            raise HTTPException(401, "Wrong password - account not deleted.")
        con.execute("DELETE FROM users WHERE id = ?", (user["id"],))   # cascades to sessions + roofs
    return {"ok": True}
