#!/usr/bin/env python3
"""Customagotchi: dependency-free, local-first web game server."""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
import traceback
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from email.utils import formatdate
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
DATA_DIR = ROOT / "data"
DB_PATH = Path(os.environ.get("CUSTOMAGOTCHI_DB", DATA_DIR / "customagotchi.db"))
COOKIE_NAME = "customagotchi_session"
SESSION_HOURS = 72
MAX_BODY = 1_000_000
ALLOWED_THEMES = {"dark", "light"}
MEMBERSHIP_RANK = {"free": 0, "plus": 1, "premium": 2, "elite": 3, "legend": 4}
STAGE_RANK = {"egg": 0, "baby": 1, "child": 2, "teen": 3, "adult": 4, "senior": 5, "ascended": 6}
SPECIES = {
    "hamster": {"name": "Hamster", "range": [0, 10], "mode": "Beginner", "decay": .64, "special": "Vorratsinstinkt"},
    "cat": {"name": "Katze", "range": [10, 20], "mode": "Lehrling", "decay": .82, "special": "Samtpfotenfokus"},
    "dog": {"name": "Hund", "range": [20, 30], "mode": "Meister", "decay": 1.0, "special": "Rudeltreue"},
    "dino": {"name": "Dino", "range": [30, 40], "mode": "Semi-Turnier", "decay": 1.2, "special": "Uralte Ausdauer"},
    "alien": {"name": "Alien", "range": [40, 50], "mode": "Turnier", "decay": 1.42, "special": "Kosmische Synapse"},
}
ITEMS = [
    ("berry-bowl", "Beeren-Bowl", "Frische Beeren und Hafer für jeden Tag.", "food", 24, "common", "🫐", {"hunger": 20, "health": 2}, "free", 0),
    ("star-snack", "Sternen-Snack", "Knusprige Trainingsbelohnung.", "food", 42, "uncommon", "⭐", {"hunger": 15, "mood": 8, "experience": 3}, "plus", 0),
    ("spring-water", "Quellwasser", "Kühles Wasser in einer sicheren Flasche.", "drink", 16, "common", "💧", {"thirst": 26}, "free", 0),
    ("vitamin-tonic", "Vitamin-Tonikum", "Unterstützt die Erholung, ersetzt aber keinen Arzt.", "medicine", 70, "uncommon", "🧪", {"health": 10, "illness": -8}, "plus", 0),
    ("soft-soap", "Wolkenseife", "Milde Pflege für Fell, Schuppen und Raumanzüge.", "hygiene", 28, "common", "🫧", {"hygiene": 24, "health": 2}, "free", 0),
    ("puzzle-orb", "Puzzle-Kugel", "Wechselt bei jeder Berührung ihr Muster.", "toy", 85, "rare", "🔮", {"boredom": -24, "intelligence": 5, "mood": 7}, "plus", 0),
    ("jump-rope", "Sprungseil", "Ein robustes Seil für kurze Fitnessrunden.", "training", 65, "uncommon", "🪢", {"fitness": 7, "energy": -6, "stress": -3}, "free", 0),
    ("nebula-cape", "Nebula-Umhang", "Kosmetischer Umhang aus schimmerndem Stoff.", "clothing", 180, "epic", "🌌", {"mood": 5, "affection": 3}, "premium", 0),
    ("moss-lamp", "Mooslicht", "Beruhigendes Licht für das Customagotchi-Zimmer.", "decoration", 120, "rare", "🪴", {"stress": -8, "sleep": 4}, "plus", 0),
    ("solstice-crown", "Sonnenwendkrone", "Seltene saisonale Turnierdekoration.", "seasonal", 320, "legendary", "👑", {"mood": 8, "discipline": 3}, "elite", 1),
]
ACHIEVEMENTS = [
    ("first-pet", "Ein neues Leben", "Erstelle dein erstes Customagotchi.", "🥚", 75),
    ("first-care", "Gute Hände", "Führe deine erste Pflegeaktion aus.", "💗", 25),
    ("healthy", "Kerngesund", "Erreiche gleichzeitig 90 Gesundheit und Hygiene.", "🌿", 60),
    ("first-game", "Spieltrieb", "Schließe dein erstes Minispiel ab.", "🎮", 40),
    ("first-tournament", "Große Bühne", "Melde dich zu einem Turnier an.", "🏆", 80),
    ("seven-days", "Eine Woche zusammen", "Begleite dein Customagotchi sieben Tage.", "🌙", 140),
    ("senior", "Lebensbegleiter", "Begleite dein Customagotchi bis ins Seniorenalter.", "🌳", 500),
]

_rate_lock = threading.Lock()
_rate_buckets: dict[str, list[float]] = {}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None = None) -> str:
    return (dt or utcnow()).isoformat(timespec="seconds")


def parse_iso(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def uid(prefix: str = "") -> str:
    return prefix + uuid.uuid4().hex


def json_dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def clamp(value: float, low: float = 0, high: float = 100) -> float:
    return round(max(low, min(high, value)), 2)


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt$16384$8$1${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        _, n, r, p, salt, expected = encoded.split("$")
        actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(actual.hex(), expected)
    except (ValueError, TypeError):
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@contextmanager
def db(transaction: bool = False):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=15, isolation_level=None)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    con.execute("PRAGMA busy_timeout=10000")
    try:
        if transaction:
            con.execute("BEGIN IMMEDIATE")
        yield con
        if transaction:
            con.commit()
    except Exception:
        if transaction:
            con.rollback()
        raise
    finally:
        con.close()


def default_stats() -> dict:
    return {
        "hunger": 84, "thirst": 86, "health": 94, "hygiene": 88, "energy": 82,
        "sleep": 86, "happiness": 88, "mood": 86, "boredom": 12, "affection": 60,
        "stress": 8, "illness": 0, "fitness": 28, "experience": 0, "age_days": 0,
        "weight": 1.0, "discipline": 20, "intelligence": 24, "social": 28,
        "is_sleeping": False, "light_on": True,
    }


def public_user(row: sqlite3.Row | dict) -> dict:
    return {key: row[key] for key in (
        "id", "email", "username", "role", "membership", "billing_cycle", "theme",
        "newsletter", "email_verified", "avatar", "coins", "created_at"
    )}


def public_pet(row: sqlite3.Row | None) -> dict | None:
    if not row:
        return None
    pet = dict(row)
    for field in ("stats_json", "traits_json", "room_json"):
        pet[field.removesuffix("_json")] = json.loads(pet.pop(field))
    return pet


def award(con: sqlite3.Connection, user_id: str, achievement_id: str) -> bool:
    achievement = con.execute("SELECT * FROM achievements WHERE id=?", (achievement_id,)).fetchone()
    if not achievement:
        return False
    inserted = con.execute(
        "INSERT OR IGNORE INTO user_achievements(user_id,achievement_id,unlocked_at) VALUES(?,?,?)",
        (user_id, achievement_id, iso()),
    ).rowcount
    if inserted:
        con.execute("UPDATE users SET coins=coins+?,updated_at=? WHERE id=?", (achievement["reward"], iso(), user_id))
        con.execute(
            "INSERT INTO notifications VALUES(?,?,?,?,?,?,?)",
            (uid("ntf_"), user_id, "achievement", "Erfolg freigeschaltet", f'{achievement["name"]} · +{achievement["reward"]} Lunaris', None, iso()),
        )
    return bool(inserted)


def seed_pet(con: sqlite3.Connection, user_id: str, species: str, name: str, difficulty: int, age_days: int = 2):
    now = utcnow()
    stats = default_stats()
    stats.update({"age_days": age_days, "experience": 55, "fitness": 42, "intelligence": 38, "affection": 72})
    stage = "child" if age_days >= 2 else "baby"
    con.execute(
        "INSERT OR IGNORE INTO pets VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (uid("pet_"), user_id, species, name, "neutral", "coral", "stardust", "#7ee7ff", "curious",
         "Beeren-Bowl", difficulty, stage, json_dumps(stats), json_dumps(["neugierig", "freundlich"]),
         json_dumps({"wall": "aurora", "floor": "moss", "decor": "moss-lamp"}), iso(now - timedelta(days=age_days)),
         iso(now), iso(now), 1, None, 0, 1, iso(now), iso(now))
    )


def init_database(fresh: bool = False):
    if fresh and DB_PATH.exists():
        DB_PATH.unlink()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with db() as con:
        con.executescript((ROOT / "schema.sql").read_text(encoding="utf-8"))
        now = utcnow()
        for item in ITEMS:
            con.execute(
                "INSERT OR REPLACE INTO items VALUES(?,?,?,?,?,?,?,?,?,?,1)",
                (*item[:7], json_dumps(item[7]), item[8], item[9]),
            )
        for a in ACHIEVEMENTS:
            con.execute("INSERT OR REPLACE INTO achievements VALUES(?,?,?,?,?)", a)
        demos = [
            ("usr_admin", "admin@customagotchi.local", "Admin Nova", "admin", "legend", "lifetime", "dark", 1, 1, 2400, -40),
            ("usr_free", "free@customagotchi.local", "Freier Fips", "user", "free", "none", "light", 0, 1, 300, -3),
            ("usr_plus", "plus@customagotchi.local", "Plus Pia", "user", "plus", "monthly", "dark", 1, 1, 850, -12),
            ("usr_premium", "premium@customagotchi.local", "Premium Pixel", "user", "premium", "yearly", "dark", 1, 1, 1500, -22),
        ]
        for user_id, email, username, role, membership, billing, theme, newsletter, verified, coins, days in demos:
            con.execute(
                "INSERT OR IGNORE INTO users VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (user_id, email, username, hash_password("Demo123!"), role, membership, billing, theme, newsletter,
                 verified, "spark", coins, 1, 0, iso(now + timedelta(days=days)), iso(now)),
            )
        seed_pet(con, "usr_plus", "hamster", "Momo", 7, 4)
        seed_pet(con, "usr_premium", "alien", "Lyra", 43, 9)
        seed_pet(con, "usr_admin", "dino", "Cosmo", 34, 18)
        for user_id in ("usr_plus", "usr_premium", "usr_admin"):
            for item_id, qty in (("berry-bowl", 3), ("spring-water", 4), ("soft-soap", 2), ("jump-rope", 1)):
                con.execute("INSERT OR IGNORE INTO inventory VALUES(?,?,?,0)", (user_id, item_id, qty))
        season_id = "season_aurora"
        con.execute(
            "INSERT OR IGNORE INTO seasons VALUES(?,?,?,?,?,?)",
            (season_id, "Aurora-Saison", "Leuchtende Pfade", iso(now - timedelta(days=7)), iso(now + timedelta(days=54)),
             json_dumps(["Aurora-Abzeichen", "600 Lunaris", "Sternenprofil"])),
        )
        tournaments = [
            ("t_aurora", season_id, "Aurora-Pflegecup", "Sieben faire Disziplinen rund um Pflege, Bindung und Gesundheit.", "care", now + timedelta(days=5), now + timedelta(days=6), now + timedelta(days=4), list(SPECIES), "child", {"coins": 600, "badge": "Aurora"}, "upcoming"),
            ("t_mind", season_id, "Synapsen-Sprint", "Ein Intelligenz- und Reaktionsturnier mit serverseitiger Punkteprüfung.", "intelligence", now + timedelta(days=12), now + timedelta(days=13), now + timedelta(days=11), ["cat", "dog", "alien"], "teen", {"coins": 850, "item": "puzzle-orb"}, "upcoming"),
        ]
        for t in tournaments:
            con.execute(
                "INSERT OR IGNORE INTO tournaments VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (t[0], t[1], t[2], t[3], t[4], iso(t[5]), iso(t[6]), iso(t[7]), json_dumps(t[8]), t[9], json_dumps(t[10]), t[11]),
            )


def evolve_pet(pet: dict, stats: dict) -> str:
    age, xp = stats.get("age_days", 0), stats.get("experience", 0)
    if age < .08:
        return "egg"
    if age < .8:
        return "baby"
    if age < 3 or xp < 25:
        return "child"
    if age < 8 or xp < 90:
        return "teen"
    if age < 25 or xp < 280:
        return "adult"
    if age < 50:
        return "senior"
    if stats.get("affection", 0) > 85 and stats.get("health", 0) > 75:
        return "ascended"
    return "senior"


def apply_offline_tick(con: sqlite3.Connection, row: sqlite3.Row) -> sqlite3.Row:
    pet = dict(row)
    last = parse_iso(pet["last_tick_at"])
    now = utcnow()
    minutes = max(0, min((now - last).total_seconds() / 60, 60 * 24 * 30))
    if minutes < .2 or not pet["alive"]:
        return row
    stats = json.loads(pet["stats_json"])
    difficulty_factor = SPECIES[pet["species"]]["decay"] * (0.85 + pet["difficulty"] / 100)
    hours = minutes / 60
    sleeping = bool(stats.get("is_sleeping"))
    rates = {
        "hunger": -.9, "thirst": -1.15, "hygiene": -.48, "sleep": -.5,
        "happiness": -.34, "mood": -.24, "affection": -.08,
        "boredom": .7, "stress": .18, "fitness": -.06,
    }
    if sleeping:
        rates.update({"energy": 7.5, "sleep": 4.2, "boredom": .12, "stress": -.8})
    else:
        rates["energy"] = -1.0
    for key, rate in rates.items():
        stats[key] = clamp(float(stats.get(key, 0)) + rate * hours * difficulty_factor)
    stats["age_days"] = round(float(stats.get("age_days", 0)) + minutes / 1440, 3)
    critical = sum(stats.get(k, 100) < 15 for k in ("hunger", "thirst", "hygiene", "energy"))
    if critical:
        stats["health"] = clamp(stats["health"] - critical * 1.4 * hours * difficulty_factor)
        stats["stress"] = clamp(stats["stress"] + critical * .8 * hours)
    if stats["hygiene"] < 12 and hours >= 2:
        stats["illness"] = clamp(stats["illness"] + .9 * hours * difficulty_factor)
    if stats["illness"] > 20:
        stats["health"] = clamp(stats["health"] - stats["illness"] / 100 * hours * difficulty_factor)
    errors = int(pet["care_errors"]) + (1 if critical and hours >= 1 else 0)
    stage = evolve_pet(pet, stats)
    alive, cause = 1, None
    threshold = {"hamster": 20, "cat": 14, "dog": 10, "dino": 7, "alien": 5}[pet["species"]]
    if stats["health"] <= 0 and errors >= threshold:
        alive = 0
        cause = "Nachvollziehbare Folgen länger andauernder Vernachlässigung"
    con.execute(
        "UPDATE pets SET stats_json=?,stage=?,last_tick_at=?,alive=?,death_cause=?,care_errors=?,version=version+1,updated_at=? WHERE id=?",
        (json_dumps(stats), stage, iso(now), alive, cause, errors, iso(now), pet["id"]),
    )
    if minutes >= 60:
        con.execute(
            "INSERT INTO game_events VALUES(?,?,?,?,?,?,?)",
            (uid("evt_"), pet["id"], pet["user_id"], "offline", f"{round(hours, 1)} Stunden nachberechnet", json_dumps({"minutes": round(minutes)}), iso(now)),
        )
    if stats["age_days"] >= 7:
        award(con, pet["user_id"], "seven-days")
    if stage == "senior":
        award(con, pet["user_id"], "senior")
    return con.execute("SELECT * FROM pets WHERE id=?", (pet["id"],)).fetchone()


def apply_changes(stats: dict, changes: dict) -> dict:
    for key, value in changes.items():
        if key in {"weight", "experience", "age_days"}:
            stats[key] = round(max(0, float(stats.get(key, 0)) + value), 2)
        elif key in {"is_sleeping", "light_on"}:
            stats[key] = bool(value)
        else:
            stats[key] = clamp(float(stats.get(key, 0)) + value)
    return stats


ACTION_DEFS = {
    "feed": ("gefüttert", {"hunger": 24, "mood": 3, "weight": .03}, 0),
    "water": ("mit Wasser versorgt", {"thirst": 28, "health": 1}, 0),
    "sleep": ("schlafen gelegt", {"is_sleeping": True, "light_on": False, "stress": -5}, 0),
    "wake": ("behutsam geweckt", {"is_sleeping": False, "light_on": True, "mood": 1}, 0),
    "light": ("Licht umgeschaltet", {}, 0),
    "bathe": ("gebadet", {"hygiene": 30, "health": 2, "stress": -3}, 0),
    "clean": ("Zimmer gereinigt", {"hygiene": 14, "happiness": 4}, 2),
    "toilet": ("Toilette gereinigt", {"hygiene": 18, "health": 2}, 2),
    "medicine": ("mit Medizin versorgt", {"illness": -18, "health": 5, "stress": 2}, 0),
    "doctor": ("ärztlich untersucht", {"illness": -30, "health": 12, "stress": 4}, -35),
    "play": ("gemeinsam gespielt", {"boredom": -24, "mood": 14, "happiness": 11, "energy": -8, "affection": 5, "experience": 3}, 4),
    "train": ("trainiert", {"fitness": 8, "discipline": 5, "energy": -14, "hunger": -5, "experience": 5}, 6),
    "pet": ("gestreichelt", {"affection": 9, "stress": -7, "mood": 5}, 1),
    "praise": ("gelobt", {"affection": 5, "discipline": 2, "happiness": 5}, 1),
    "scold": ("ruhig ermahnt", {"discipline": 5, "affection": -2, "stress": 3}, 1),
    "occupy": ("beschäftigt", {"boredom": -18, "intelligence": 4, "mood": 6, "experience": 2}, 3),
    "walk": ("spazieren geführt", {"fitness": 5, "social": 6, "mood": 8, "energy": -9, "hunger": -4, "experience": 3}, 5),
}


def rate_allowed(key: str, limit: int, window: int) -> bool:
    now = time.monotonic()
    with _rate_lock:
        bucket = [t for t in _rate_buckets.get(key, []) if now - t < window]
        if len(bucket) >= limit:
            _rate_buckets[key] = bucket
            return False
        bucket.append(now)
        _rate_buckets[key] = bucket
        return True


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details=None):
        self.status, self.code, self.message, self.details = status, code, message, details
        super().__init__(message)


class Handler(BaseHTTPRequestHandler):
    server_version = "Customagotchi/1.0"

    def log_message(self, fmt, *args):
        sys.stdout.write(f"[{self.log_date_time_string()}] {fmt % args}\n")

    @property
    def path_only(self):
        return urlparse(self.path).path.rstrip("/") or "/"

    def _headers(self, status=200, content_type="application/json; charset=utf-8", length=None, cookie=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        if length is not None:
            self.send_header("Content-Length", str(length))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
        self.send_header("Cache-Control", "no-store" if self.path_only.startswith("/api") else "public, max-age=300")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()

    def json(self, status=200, data=None, cookie=None):
        body = json_dumps(data if data is not None else {}).encode("utf-8")
        self._headers(status, length=len(body), cookie=cookie)
        self.wfile.write(body)

    def error_json(self, err: ApiError):
        payload = {"error": {"code": err.code, "message": err.message}}
        if err.details is not None:
            payload["error"]["details"] = err.details
        self.json(err.status, payload)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ApiError(400, "INVALID_LENGTH", "Ungültige Anfragegröße.")
        if length <= 0 or length > MAX_BODY:
            raise ApiError(400 if length <= 0 else 413, "INVALID_BODY", "Anfragedaten fehlen oder sind zu groß.")
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ApiError(400, "INVALID_JSON", "Die gesendeten Daten sind ungültig.")

    def session(self, required=True):
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        token = cookie.get(COOKIE_NAME)
        if not token:
            if required:
                raise ApiError(401, "AUTH_REQUIRED", "Bitte melde dich an.")
            return None
        with db() as con:
            row = con.execute(
                "SELECT s.*,u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1",
                (token_hash(token.value), iso()),
            ).fetchone()
        if not row and required:
            raise ApiError(401, "SESSION_EXPIRED", "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.")
        return row

    def require_csrf(self, session):
        if not hmac.compare_digest(self.headers.get("X-CSRF-Token", ""), session["csrf_token"]):
            raise ApiError(403, "CSRF_FAILED", "Sicherheitsprüfung fehlgeschlagen. Bitte lade die Seite neu.")

    def require_admin(self, session):
        if session["role"] != "admin":
            raise ApiError(403, "ADMIN_REQUIRED", "Nur Administratoren dürfen diese Aktion ausführen.")

    def audit(self, con, actor, action, target_type, target_id=None, metadata=None):
        ip = self.client_address[0] if self.client_address else "local"
        con.execute(
            "INSERT INTO audit_logs VALUES(?,?,?,?,?,?,?,?)",
            (uid("aud_"), actor, action, target_type, target_id, hashlib.sha256(ip.encode()).hexdigest()[:16], json_dumps(metadata or {}), iso()),
        )

    def do_GET(self):
        try:
            if self.path_only.startswith("/api"):
                return self.handle_get()
            return self.serve_static()
        except ApiError as err:
            self.error_json(err)
        except Exception:
            traceback.print_exc()
            self.json(500, {"error": {"code": "SERVER_ERROR", "message": "Ein interner Fehler ist aufgetreten."}})

    def do_POST(self):
        self.handle_write("POST")

    def do_PATCH(self):
        self.handle_write("PATCH")

    def do_DELETE(self):
        self.handle_write("DELETE")

    def handle_write(self, method):
        try:
            if not self.path_only.startswith("/api"):
                raise ApiError(405, "METHOD_NOT_ALLOWED", "Methode nicht erlaubt.")
            return self.handle_api_write(method)
        except ApiError as err:
            self.error_json(err)
        except Exception:
            traceback.print_exc()
            self.json(500, {"error": {"code": "SERVER_ERROR", "message": "Ein interner Fehler ist aufgetreten."}})

    def serve_static(self):
        requested = "index.html" if self.path_only == "/" else unquote(self.path_only.lstrip("/"))
        path = (STATIC_DIR / requested).resolve()
        if STATIC_DIR.resolve() not in path.parents and path != STATIC_DIR.resolve():
            raise ApiError(403, "FORBIDDEN", "Zugriff verweigert.")
        if not path.is_file():
            path = STATIC_DIR / "index.html"
        body = path.read_bytes()
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if path.suffix in {".html", ".css", ".js", ".webmanifest", ".svg"}:
            ctype += "; charset=utf-8"
        self._headers(200, ctype, len(body))
        self.wfile.write(body)

    def handle_get(self):
        path = self.path_only
        if path == "/api/health":
            return self.json(200, {"status": "ok", "time": iso(), "version": "1.0.0"})
        if path == "/api/bootstrap":
            session = self.session(False)
            with db(transaction=True) as con:
                tournaments = [dict(r) for r in con.execute("SELECT * FROM tournaments ORDER BY starts_at LIMIT 8")]
                for t in tournaments:
                    t["allowed_species"] = json.loads(t.pop("allowed_species_json"))
                    t["reward"] = json.loads(t.pop("reward_json"))
                leaders = [dict(r) for r in con.execute(
                    "SELECT u.username,p.name,p.species,p.stage,json_extract(p.stats_json,'$.happiness') happiness,json_extract(p.stats_json,'$.fitness') fitness FROM pets p JOIN users u ON u.id=p.user_id WHERE p.alive=1 ORDER BY happiness DESC,fitness DESC LIMIT 8"
                )]
                payload = {"species": SPECIES, "memberships": MEMBERSHIP_RANK, "tournaments": tournaments, "leaders": leaders}
                if session:
                    pet_row = con.execute("SELECT * FROM pets WHERE user_id=?", (session["user_id"],)).fetchone()
                    if pet_row:
                        pet_row = apply_offline_tick(con, pet_row)
                    payload.update({"user": public_user(session), "csrf": session["csrf_token"], "pet": public_pet(pet_row)})
                return self.json(200, payload)
        session = self.session(True)
        if path == "/api/me":
            with db(transaction=True) as con:
                pet = con.execute("SELECT * FROM pets WHERE user_id=?", (session["user_id"],)).fetchone()
                if pet:
                    pet = apply_offline_tick(con, pet)
                ach = [dict(r) for r in con.execute(
                    "SELECT a.*,ua.unlocked_at FROM achievements a LEFT JOIN user_achievements ua ON ua.achievement_id=a.id AND ua.user_id=? ORDER BY ua.unlocked_at DESC,a.name", (session["user_id"],)
                )]
                notifications = [dict(r) for r in con.execute("SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 12", (session["user_id"],))]
                return self.json(200, {"user": public_user(session), "csrf": session["csrf_token"], "pet": public_pet(pet), "achievements": ach, "notifications": notifications})
        if path in {"/api/shop", "/api/inventory"}:
            with db() as con:
                items = [dict(r) for r in con.execute(
                    "SELECT i.*,COALESCE(inv.quantity,0) quantity,COALESCE(inv.equipped,0) equipped FROM items i LEFT JOIN inventory inv ON inv.item_id=i.id AND inv.user_id=? WHERE i.active=1 ORDER BY i.category,i.price", (session["user_id"],)
                )]
                for item in items:
                    item["effects"] = json.loads(item.pop("effects_json"))
                return self.json(200, {"items": items, "coins": session["coins"]})
        if path == "/api/events":
            with db() as con:
                rows = [dict(r) for r in con.execute("SELECT * FROM game_events WHERE user_id=? ORDER BY created_at DESC LIMIT 25", (session["user_id"],))]
                return self.json(200, {"events": rows})
        if path == "/api/minigames/start":
            query = urlparse(self.path).query
            game = next((part.split("=", 1)[1] for part in query.split("&") if part.startswith("game=")), "orbit")
            if game not in {"burrow", "pounce", "fetch", "meteor", "orbit"}:
                raise ApiError(400, "UNKNOWN_GAME", "Dieses Minispiel existiert nicht.")
            with db(transaction=True) as con:
                pet = con.execute("SELECT * FROM pets WHERE user_id=? AND alive=1", (session["user_id"],)).fetchone()
                if not pet:
                    raise ApiError(409, "PET_REQUIRED", "Du benötigst ein lebendes Customagotchi.")
                nonce = secrets.token_urlsafe(24)
                con.execute("INSERT INTO game_nonces VALUES(?,?,?,?,NULL)", (nonce, session["user_id"], game, iso()))
                return self.json(200, {"nonce": nonce, "game": game, "issuedAt": iso()})
        if path == "/api/admin/overview":
            self.require_admin(session)
            with db() as con:
                counts = {table: con.execute(f"SELECT COUNT(*) n FROM {table}").fetchone()["n"] for table in ("users", "pets", "tournaments", "tournament_entries", "game_events")}
                users = [dict(r) for r in con.execute("SELECT id,email,username,role,membership,theme,newsletter,active,created_at FROM users ORDER BY created_at DESC LIMIT 50")]
                logs = [dict(r) for r in con.execute("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 20")]
                return self.json(200, {"counts": counts, "users": users, "logs": logs})
        raise ApiError(404, "NOT_FOUND", "API-Endpunkt nicht gefunden.")

    def handle_api_write(self, method):
        path = self.path_only
        ip_key = f"{self.client_address[0]}:{path}"
        if path in {"/api/auth/login", "/api/auth/register", "/api/auth/password-reset"}:
            if not rate_allowed(ip_key, 8, 60):
                raise ApiError(429, "RATE_LIMIT", "Zu viele Versuche. Bitte warte eine Minute.")
            return self.handle_auth(path)
        session = self.session(True)
        self.require_csrf(session)
        data = self.read_json() if method != "DELETE" or int(self.headers.get("Content-Length", "0")) else {}
        if path == "/api/auth/logout":
            with db(transaction=True) as con:
                cookie = SimpleCookie(self.headers.get("Cookie", ""))
                if cookie.get(COOKIE_NAME):
                    con.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash(cookie[COOKIE_NAME].value),))
            return self.json(200, {"ok": True}, cookie=f"{COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
        if path == "/api/profile" and method == "PATCH":
            return self.update_profile(session, data)
        if path == "/api/pets" and method == "POST":
            return self.create_pet(session, data)
        if path == "/api/pet/action" and method == "POST":
            return self.pet_action(session, data)
        if path == "/api/shop/buy" and method == "POST":
            return self.buy_item(session, data)
        if path == "/api/inventory/use" and method == "POST":
            return self.use_item(session, data)
        if path == "/api/minigames/score" and method == "POST":
            return self.submit_score(session, data)
        if path == "/api/tournaments/register" and method == "POST":
            return self.register_tournament(session, data)
        if path == "/api/notifications/read" and method == "POST":
            with db(transaction=True) as con:
                con.execute("UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL", (iso(), session["user_id"]))
            return self.json(200, {"ok": True})
        if path == "/api/admin/users" and method == "PATCH":
            self.require_admin(session)
            return self.admin_update_user(session, data)
        if path == "/api/account" and method == "DELETE":
            return self.delete_account(session, data)
        raise ApiError(404, "NOT_FOUND", "API-Endpunkt nicht gefunden.")

    def handle_auth(self, path):
        data = self.read_json()
        if path == "/api/auth/password-reset":
            email = str(data.get("email", "")).strip().lower()
            with db(transaction=True) as con:
                user = con.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
                if user:
                    raw = secrets.token_urlsafe(32)
                    con.execute("INSERT INTO password_resets VALUES(?,?,?,?,?)", (token_hash(raw), user["id"], iso(utcnow() + timedelta(minutes=30)), None, iso()))
                    (DATA_DIR / "mail-outbox.log").open("a", encoding="utf-8").write(f"{iso()} reset for {email}: {raw}\n")
            return self.json(200, {"ok": True, "message": "Wenn das Konto existiert, wurde eine lokale Test-E-Mail erzeugt."})
        email = str(data.get("email", "")).strip().lower()
        password = str(data.get("password", ""))
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            raise ApiError(400, "INVALID_EMAIL", "Bitte gib eine gültige E-Mail-Adresse ein.")
        if path == "/api/auth/register":
            username = re.sub(r"\s+", " ", str(data.get("username", "")).strip())
            if not 2 <= len(username) <= 28:
                raise ApiError(400, "INVALID_USERNAME", "Der Anzeigename muss 2 bis 28 Zeichen lang sein.")
            if len(password) < 10 or not re.search(r"[A-Z]", password) or not re.search(r"[a-z]", password) or not re.search(r"\d", password):
                raise ApiError(400, "WEAK_PASSWORD", "Nutze mindestens 10 Zeichen sowie Groß-, Kleinbuchstaben und eine Zahl.")
            with db(transaction=True) as con:
                if con.execute("SELECT 1 FROM users WHERE email=? OR username=?", (email, username)).fetchone():
                    raise ApiError(409, "ACCOUNT_EXISTS", "E-Mail-Adresse oder Anzeigename wird bereits verwendet.")
                user_id = uid("usr_")
                now = iso()
                con.execute(
                    "INSERT INTO users VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (user_id, email, username, hash_password(password), "user", "free", "none", "dark", int(bool(data.get("newsletter"))), 0, "spark", 300, 1, 0, now, now),
                )
                if data.get("newsletter"):
                    con.execute("INSERT INTO newsletter_events VALUES(?,?,?,?,?)", (uid("nl_"), user_id, 1, "registration", now))
                self.audit(con, user_id, "register", "user", user_id)
        with db(transaction=True) as con:
            user = con.execute("SELECT * FROM users WHERE email=? AND active=1", (email,)).fetchone()
            if not user or not verify_password(password, user["password_hash"]):
                raise ApiError(401, "INVALID_LOGIN", "E-Mail-Adresse oder Passwort ist falsch.")
            con.execute("DELETE FROM sessions WHERE expires_at<=?", (iso(),))
            raw_token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
            con.execute("INSERT INTO sessions VALUES(?,?,?,?,?)", (token_hash(raw_token), user["id"], csrf, iso(utcnow() + timedelta(hours=SESSION_HOURS)), iso()))
            self.audit(con, user["id"], "login", "session")
            pet = con.execute("SELECT * FROM pets WHERE user_id=?", (user["id"],)).fetchone()
            cookie = f"{COOKIE_NAME}={raw_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_HOURS*3600}"
            if os.environ.get("CUSTOMAGOTCHI_SECURE_COOKIE") == "1":
                cookie += "; Secure"
            return self.json(200, {"user": public_user(user), "csrf": csrf, "pet": public_pet(pet)}, cookie=cookie)

    def update_profile(self, session, data):
        fields, args = [], []
        if "theme" in data:
            if data["theme"] not in ALLOWED_THEMES:
                raise ApiError(400, "INVALID_THEME", "Unbekanntes Farbschema.")
            fields.append("theme=?"); args.append(data["theme"])
        if "newsletter" in data:
            value = int(bool(data["newsletter"]))
            fields.append("newsletter=?"); args.append(value)
        if "avatar" in data:
            avatar = str(data["avatar"])
            if avatar not in {"spark", "leaf", "moon", "comet"}:
                raise ApiError(400, "INVALID_AVATAR", "Unbekanntes Profilbild.")
            fields.append("avatar=?"); args.append(avatar)
        if not fields:
            raise ApiError(400, "NO_CHANGES", "Es wurden keine Änderungen übermittelt.")
        args.extend([iso(), session["user_id"]])
        with db(transaction=True) as con:
            con.execute(f"UPDATE users SET {','.join(fields)},updated_at=? WHERE id=?", args)
            if "newsletter" in data:
                con.execute("INSERT INTO newsletter_events VALUES(?,?,?,?,?)", (uid("nl_"), session["user_id"], int(bool(data["newsletter"])), "profile", iso()))
            self.audit(con, session["user_id"], "profile.update", "user", session["user_id"], {"fields": list(data)})
            user = con.execute("SELECT * FROM users WHERE id=?", (session["user_id"],)).fetchone()
        return self.json(200, {"user": public_user(user)})

    def create_pet(self, session, data):
        if MEMBERSHIP_RANK.get(session["membership"], 0) < 1:
            raise ApiError(403, "PLUS_REQUIRED", "Ein eigenes Customagotchi ist ab Plus verfügbar.")
        species = str(data.get("species", ""))
        if species not in SPECIES:
            raise ApiError(400, "INVALID_SPECIES", "Bitte wähle eine gültige Art.")
        name = re.sub(r"\s+", " ", str(data.get("name", "")).strip())
        if not 2 <= len(name) <= 20:
            raise ApiError(400, "INVALID_NAME", "Der Name muss 2 bis 20 Zeichen lang sein.")
        difficulty = int(data.get("difficulty", SPECIES[species]["range"][0]))
        low, high = SPECIES[species]["range"]
        if not low <= difficulty <= high:
            raise ApiError(400, "INVALID_DIFFICULTY", f"Für diese Art sind Werte von {low} bis {high} erlaubt.")
        safe = lambda key, default, allowed: str(data.get(key, default)) if str(data.get(key, default)) in allowed else default
        gender = safe("gender", "neutral", {"female", "male", "neutral"})
        color = safe("color", "coral", {"coral", "mint", "violet", "gold", "sky"})
        pattern = safe("pattern", "stardust", {"stardust", "spots", "stripes", "plain", "nebula"})
        personality = safe("personality", "curious", {"curious", "brave", "gentle", "playful", "clever"})
        eye_color = safe("eyeColor", "#7ee7ff", {"#7ee7ff", "#b8ff72", "#ffcf70", "#d8a4ff", "#ff8e9e"})
        favorite = str(data.get("favoriteFood", "Beeren-Bowl"))[:40]
        traits = list(dict.fromkeys(data.get("traits", ["neugierig"])))[:3]
        if any(not isinstance(t, str) or len(t) > 20 for t in traits):
            raise ApiError(400, "INVALID_TRAITS", "Ungültige Charaktereigenschaften.")
        now = iso()
        pet_id = uid("pet_")
        with db(transaction=True) as con:
            if con.execute("SELECT 1 FROM pets WHERE user_id=?", (session["user_id"],)).fetchone():
                raise ApiError(409, "PET_EXISTS", "Dieses Konto besitzt bereits ein Customagotchi.")
            con.execute(
                "INSERT INTO pets VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (pet_id, session["user_id"], species, name, gender, color, pattern, eye_color, personality, favorite,
                 difficulty, "egg", json_dumps(default_stats()), json_dumps(traits), json_dumps({"wall": "aurora", "floor": "moss", "decor": "none"}),
                 now, now, now, 1, None, 0, 1, now, now),
            )
            award(con, session["user_id"], "first-pet")
            self.audit(con, session["user_id"], "pet.create", "pet", pet_id, {"species": species, "difficulty": difficulty})
            pet = con.execute("SELECT * FROM pets WHERE id=?", (pet_id,)).fetchone()
        return self.json(201, {"pet": public_pet(pet)})

    def pet_action(self, session, data):
        action = str(data.get("action", ""))
        if action not in ACTION_DEFS:
            raise ApiError(400, "UNKNOWN_ACTION", "Unbekannte Pflegeaktion.")
        with db(transaction=True) as con:
            row = con.execute("SELECT * FROM pets WHERE user_id=?", (session["user_id"],)).fetchone()
            if not row:
                raise ApiError(404, "PET_REQUIRED", "Du besitzt noch kein Customagotchi.")
            row = apply_offline_tick(con, row)
            if not row["alive"]:
                raise ApiError(409, "PET_DECEASED", "Diese Aktion ist nach dem Tod nicht mehr möglich.")
            stats = json.loads(row["stats_json"])
            label, changes, coins = ACTION_DEFS[action]
            changes = dict(changes)
            if stats.get("is_sleeping") and action not in {"wake", "light", "doctor", "medicine"}:
                raise ApiError(409, "PET_SLEEPING", f"{row['name']} schläft. Wecke dein Customagotchi zuerst.")
            if action == "sleep" and stats.get("is_sleeping"):
                raise ApiError(409, "ALREADY_SLEEPING", f"{row['name']} schläft bereits.")
            if action == "wake" and not stats.get("is_sleeping"):
                raise ApiError(409, "ALREADY_AWAKE", f"{row['name']} ist bereits wach.")
            if action == "light":
                changes["light_on"] = not stats.get("light_on", True)
            if action == "medicine" and stats.get("illness", 0) <= 0:
                changes = {"health": 1, "stress": 1}
                label = "vorsorglich untersucht"
            if coins < 0:
                user = con.execute("SELECT coins FROM users WHERE id=?", (session["user_id"],)).fetchone()
                if user["coins"] < abs(coins):
                    raise ApiError(409, "NOT_ENOUGH_COINS", "Für den Arztbesuch fehlen Lunaris.")
                con.execute("UPDATE users SET coins=coins+?,updated_at=? WHERE id=?", (coins, iso(), session["user_id"]))
            elif coins:
                con.execute("UPDATE users SET coins=coins+?,updated_at=? WHERE id=?", (coins, iso(), session["user_id"]))
            apply_changes(stats, changes)
            stage = evolve_pet(dict(row), stats)
            con.execute("UPDATE pets SET stats_json=?,stage=?,last_action_at=?,version=version+1,updated_at=? WHERE id=?", (json_dumps(stats), stage, iso(), iso(), row["id"]))
            con.execute("INSERT INTO game_events VALUES(?,?,?,?,?,?,?)", (uid("evt_"), row["id"], session["user_id"], "care", f"{row['name']} wurde {label}", json_dumps(changes), iso()))
            award(con, session["user_id"], "first-care")
            if stats["health"] >= 90 and stats["hygiene"] >= 90:
                award(con, session["user_id"], "healthy")
            pet = con.execute("SELECT * FROM pets WHERE id=?", (row["id"],)).fetchone()
            user = con.execute("SELECT * FROM users WHERE id=?", (session["user_id"],)).fetchone()
        return self.json(200, {"pet": public_pet(pet), "user": public_user(user), "message": f"{row['name']} wurde {label}."})

    def buy_item(self, session, data):
        item_id = str(data.get("itemId", ""))
        qty = max(1, min(10, int(data.get("quantity", 1))))
        with db(transaction=True) as con:
            item = con.execute("SELECT * FROM items WHERE id=? AND active=1", (item_id,)).fetchone()
            user = con.execute("SELECT * FROM users WHERE id=?", (session["user_id"],)).fetchone()
            if not item:
                raise ApiError(404, "ITEM_NOT_FOUND", "Gegenstand nicht gefunden.")
            if MEMBERSHIP_RANK[user["membership"]] < MEMBERSHIP_RANK[item["min_membership"]]:
                raise ApiError(403, "MEMBERSHIP_REQUIRED", f'{item["name"]} benötigt mindestens {item["min_membership"].title()}.' )
            total = item["price"] * qty
            if user["coins"] < total:
                raise ApiError(409, "NOT_ENOUGH_COINS", "Dafür reichen deine Lunaris noch nicht.")
            balance = user["coins"] - total
            con.execute("UPDATE users SET coins=?,updated_at=? WHERE id=?", (balance, iso(), user["id"]))
            con.execute("INSERT INTO inventory VALUES(?,?,?,0) ON CONFLICT(user_id,item_id) DO UPDATE SET quantity=quantity+excluded.quantity", (user["id"], item_id, qty))
            con.execute("INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?)", (uid("txn_"), user["id"], item_id, "purchase", -total, balance, json_dumps({"quantity": qty}), iso()))
        return self.json(200, {"ok": True, "coins": balance, "message": f"{qty}× {item['name']} gekauft."})

    def use_item(self, session, data):
        item_id = str(data.get("itemId", ""))
        with db(transaction=True) as con:
            item = con.execute("SELECT i.*,inv.quantity FROM items i JOIN inventory inv ON inv.item_id=i.id WHERE inv.user_id=? AND i.id=?", (session["user_id"], item_id)).fetchone()
            pet = con.execute("SELECT * FROM pets WHERE user_id=? AND alive=1", (session["user_id"],)).fetchone()
            if not item or item["quantity"] < 1:
                raise ApiError(409, "ITEM_UNAVAILABLE", "Dieser Gegenstand ist nicht im Inventar.")
            if not pet:
                raise ApiError(409, "PET_REQUIRED", "Du benötigst ein lebendes Customagotchi.")
            stats = json.loads(pet["stats_json"])
            effects = json.loads(item["effects_json"])
            apply_changes(stats, effects)
            if item["category"] in {"clothing", "decoration"}:
                con.execute("UPDATE inventory SET equipped=CASE WHEN item_id=? THEN 1 ELSE 0 END WHERE user_id=? AND item_id IN (SELECT id FROM items WHERE category=?)", (item_id, session["user_id"], item["category"]))
            else:
                con.execute("UPDATE inventory SET quantity=quantity-1 WHERE user_id=? AND item_id=?", (session["user_id"], item_id))
            con.execute("UPDATE pets SET stats_json=?,version=version+1,updated_at=? WHERE id=?", (json_dumps(stats), iso(), pet["id"]))
            con.execute("INSERT INTO game_events VALUES(?,?,?,?,?,?,?)", (uid("evt_"), pet["id"], session["user_id"], "item", f"{item['name']} verwendet", json_dumps(effects), iso()))
            updated = con.execute("SELECT * FROM pets WHERE id=?", (pet["id"],)).fetchone()
        return self.json(200, {"pet": public_pet(updated), "message": f"{item['name']} wurde verwendet."})

    def submit_score(self, session, data):
        game, nonce = str(data.get("game", "")), str(data.get("nonce", ""))
        score, duration = int(data.get("score", -1)), int(data.get("durationMs", -1))
        if game not in {"burrow", "pounce", "fetch", "meteor", "orbit"} or not 0 <= score <= 1000 or not 1000 <= duration <= 180000:
            raise ApiError(400, "INVALID_SCORE", "Das Spielergebnis liegt außerhalb der erlaubten Werte.")
        max_plausible = min(1000, 50 + int(duration / 120))
        if score > max_plausible:
            raise ApiError(422, "IMPLAUSIBLE_SCORE", "Das Ergebnis konnte nicht verifiziert werden.")
        with db(transaction=True) as con:
            n = con.execute("SELECT * FROM game_nonces WHERE nonce=? AND user_id=? AND game=? AND used_at IS NULL", (nonce, session["user_id"], game)).fetchone()
            if not n or utcnow() - parse_iso(n["issued_at"]) > timedelta(minutes=4):
                raise ApiError(409, "INVALID_NONCE", "Diese Spielrunde ist abgelaufen oder wurde bereits gewertet.")
            pet = con.execute("SELECT * FROM pets WHERE user_id=? AND alive=1", (session["user_id"],)).fetchone()
            if not pet:
                raise ApiError(409, "PET_REQUIRED", "Du benötigst ein lebendes Customagotchi.")
            con.execute("UPDATE game_nonces SET used_at=? WHERE nonce=?", (iso(), nonce))
            con.execute("INSERT INTO minigame_scores VALUES(?,?,?,?,?,?,?,?)", (uid("score_"), session["user_id"], pet["id"], game, score, duration, nonce, iso()))
            reward = max(3, min(45, score // 18))
            con.execute("UPDATE users SET coins=coins+?,updated_at=? WHERE id=?", (reward, iso(), session["user_id"]))
            stats = json.loads(pet["stats_json"])
            changes = {"mood": min(10, score / 60), "experience": max(2, score / 25), "energy": -6, "boredom": -12}
            if game in {"burrow", "pounce", "orbit"}: changes["intelligence"] = min(8, score / 80)
            else: changes["fitness"] = min(8, score / 80)
            apply_changes(stats, changes)
            con.execute("UPDATE pets SET stats_json=?,stage=?,version=version+1,updated_at=? WHERE id=?", (json_dumps(stats), evolve_pet(dict(pet), stats), iso(), pet["id"]))
            award(con, session["user_id"], "first-game")
            user = con.execute("SELECT * FROM users WHERE id=?", (session["user_id"],)).fetchone()
            updated = con.execute("SELECT * FROM pets WHERE id=?", (pet["id"],)).fetchone()
        return self.json(200, {"verified": True, "reward": reward, "user": public_user(user), "pet": public_pet(updated)})

    def register_tournament(self, session, data):
        tournament_id = str(data.get("tournamentId", ""))
        with db(transaction=True) as con:
            user = con.execute("SELECT * FROM users WHERE id=?", (session["user_id"],)).fetchone()
            pet = con.execute("SELECT * FROM pets WHERE user_id=? AND alive=1", (session["user_id"],)).fetchone()
            tournament = con.execute("SELECT * FROM tournaments WHERE id=?", (tournament_id,)).fetchone()
            if not tournament: raise ApiError(404, "TOURNAMENT_NOT_FOUND", "Turnier nicht gefunden.")
            if not pet: raise ApiError(409, "PET_REQUIRED", "Du benötigst ein lebendes Customagotchi.")
            top_three = MEMBERSHIP_RANK[user["membership"]] >= MEMBERSHIP_RANK["premium"]
            old_enough = utcnow() - parse_iso(user["created_at"]) >= timedelta(days=7)
            reasons = []
            if not (top_three or old_enough): reasons.append("Konto ist noch keine sieben Tage alt und besitzt keine der drei höchsten Mitgliedschaften")
            if not user["active"]: reasons.append("Konto ist nicht aktiv")
            if user["tournament_banned"]: reasons.append("aktuelle Turniersperre")
            if parse_iso(tournament["registration_deadline"]) < utcnow(): reasons.append("Anmeldefrist ist abgelaufen")
            if pet["species"] not in json.loads(tournament["allowed_species_json"]): reasons.append("Art ist nicht zugelassen")
            if STAGE_RANK[pet["stage"]] < STAGE_RANK[tournament["min_stage"]]: reasons.append("Entwicklungsstufe ist zu niedrig")
            if json.loads(pet["stats_json"])["health"] < 50: reasons.append("Gesundheit liegt unter 50")
            if reasons: raise ApiError(403, "NOT_ELIGIBLE", "Teilnahmebedingungen sind nicht erfüllt.", reasons)
            entry_id = uid("entry_")
            try:
                con.execute("INSERT INTO tournament_entries VALUES(?,?,?,?,NULL,'{}','registered',?)", (entry_id, tournament_id, user["id"], pet["id"], iso()))
            except sqlite3.IntegrityError:
                raise ApiError(409, "ALREADY_REGISTERED", "Du bist bereits für dieses Turnier registriert.")
            award(con, user["id"], "first-tournament")
            self.audit(con, user["id"], "tournament.register", "tournament", tournament_id)
        return self.json(201, {"entryId": entry_id, "message": "Turnieranmeldung bestätigt."})

    def admin_update_user(self, session, data):
        user_id = str(data.get("userId", ""))
        membership = str(data.get("membership", ""))
        if membership not in MEMBERSHIP_RANK:
            raise ApiError(400, "INVALID_MEMBERSHIP", "Ungültige Mitgliedschaft.")
        with db(transaction=True) as con:
            if not con.execute("SELECT 1 FROM users WHERE id=?", (user_id,)).fetchone():
                raise ApiError(404, "USER_NOT_FOUND", "Benutzerkonto nicht gefunden.")
            con.execute("UPDATE users SET membership=?,billing_cycle=?,updated_at=? WHERE id=?", (membership, "none" if membership == "free" else str(data.get("billingCycle", "monthly")), iso(), user_id))
            self.audit(con, session["user_id"], "membership.update", "user", user_id, {"membership": membership})
        return self.json(200, {"ok": True})

    def delete_account(self, session, data):
        password = str(data.get("password", ""))
        with db(transaction=True) as con:
            user = con.execute("SELECT * FROM users WHERE id=?", (session["user_id"],)).fetchone()
            if not verify_password(password, user["password_hash"]):
                raise ApiError(401, "INVALID_PASSWORD", "Das Passwort ist nicht korrekt.")
            self.audit(con, user["id"], "account.delete", "user", user["id"])
            con.execute("DELETE FROM users WHERE id=?", (user["id"],))
        return self.json(200, {"ok": True}, cookie=f"{COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")


def main():
    parser = argparse.ArgumentParser(description="Customagotchi web game")
    parser.add_argument("--host", default=os.environ.get("CUSTOMAGOTCHI_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("CUSTOMAGOTCHI_PORT", "8765")))
    parser.add_argument("--init-only", action="store_true")
    parser.add_argument("--fresh", action="store_true")
    args = parser.parse_args()
    init_database(args.fresh)
    if args.init_only:
        print(f"Database ready: {DB_PATH}")
        return
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Customagotchi läuft auf http://{args.host}:{args.port}")
    print("Beenden mit Strg+C")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer beendet.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
