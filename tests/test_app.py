import http.client
import json
import tempfile
import threading
import unittest
from datetime import timedelta
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server as app


class Client:
    def __init__(self, host, port):
        self.host, self.port = host, port
        self.cookie = None
        self.csrf = None

    def request(self, method, path, body=None, csrf=True):
        con = http.client.HTTPConnection(self.host, self.port, timeout=5)
        headers = {"Accept": "application/json"}
        if self.cookie:
            headers["Cookie"] = self.cookie
        if csrf and self.csrf and method != "GET":
            headers["X-CSRF-Token"] = self.csrf
        payload = None
        if body is not None:
            payload = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        con.request(method, path, payload, headers)
        response = con.getresponse()
        raw = response.read()
        cookie = response.getheader("Set-Cookie")
        if cookie:
            self.cookie = cookie.split(";", 1)[0]
        data = json.loads(raw) if raw else {}
        con.close()
        if data.get("csrf"):
            self.csrf = data["csrf"]
        return response.status, data

    def login(self, email="plus@customagotchi.local", password="Demo123!"):
        status, data = self.request("POST", "/api/auth/login", {"email": email, "password": password})
        self.csrf = data.get("csrf")
        return status, data


class CustomagotchiIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        app.DB_PATH = Path(cls.tmp.name) / "test.db"
        app.init_database(fresh=True)
        cls.server = app.ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        cls.host, cls.port = cls.server.server_address
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.tmp.cleanup()

    def test_01_health_and_security_headers(self):
        con = http.client.HTTPConnection(self.host, self.port)
        con.request("GET", "/api/health")
        response = con.getresponse()
        data = json.loads(response.read())
        self.assertEqual(response.status, 200)
        self.assertEqual(data["status"], "ok")
        self.assertEqual(response.getheader("X-Frame-Options"), "DENY")

    def test_02_login_and_persist_theme(self):
        client = Client(self.host, self.port)
        status, data = client.login()
        self.assertEqual(status, 200)
        self.assertEqual(data["user"]["membership"], "plus")
        status, data = client.request("PATCH", "/api/profile", {"theme": "light"})
        self.assertEqual(status, 200)
        self.assertEqual(data["user"]["theme"], "light")
        status, data = client.request("GET", "/api/bootstrap")
        self.assertEqual(data["user"]["theme"], "light")

    def test_03_csrf_is_required(self):
        client = Client(self.host, self.port)
        client.login()
        status, data = client.request("PATCH", "/api/profile", {"theme": "dark"}, csrf=False)
        self.assertEqual(status, 403)
        self.assertEqual(data["error"]["code"], "CSRF_FAILED")

    def test_04_free_member_cannot_create_pet(self):
        client = Client(self.host, self.port)
        email = "newplayer@example.test"
        status, data = client.request("POST", "/api/auth/register", {
            "email": email, "username": "Neue Nova", "password": "SecurePass123", "newsletter": True
        })
        self.assertEqual(status, 200)
        client.csrf = data["csrf"]
        status, data = client.request("POST", "/api/pets", {"species": "hamster", "name": "Pico", "difficulty": 4})
        self.assertEqual(status, 403)
        self.assertEqual(data["error"]["code"], "PLUS_REQUIRED")

    def test_05_care_action_changes_real_state(self):
        client = Client(self.host, self.port)
        client.login()
        _, before = client.request("GET", "/api/me")
        old_energy = before["pet"]["stats"]["energy"]
        status, data = client.request("POST", "/api/pet/action", {"action": "play"})
        self.assertEqual(status, 200)
        self.assertLess(data["pet"]["stats"]["energy"], old_energy)
        self.assertIn("gespielt", data["message"])

    def test_06_shop_purchase_and_use(self):
        client = Client(self.host, self.port)
        client.login()
        status, bought = client.request("POST", "/api/shop/buy", {"itemId": "spring-water", "quantity": 1})
        self.assertEqual(status, 200)
        status, used = client.request("POST", "/api/inventory/use", {"itemId": "spring-water"})
        self.assertEqual(status, 200)
        self.assertIn("verwendet", used["message"])

    def test_07_minigame_score_validation(self):
        client = Client(self.host, self.port)
        client.login()
        status, round_data = client.request("GET", "/api/minigames/start?game=burrow")
        self.assertEqual(status, 200)
        status, result = client.request("POST", "/api/minigames/score", {
            "game": "burrow", "nonce": round_data["nonce"], "score": 50, "durationMs": 20000
        })
        self.assertEqual(status, 200)
        self.assertTrue(result["verified"])
        _, bad_round = client.request("GET", "/api/minigames/start?game=burrow")
        status, result = client.request("POST", "/api/minigames/score", {
            "game": "burrow", "nonce": bad_round["nonce"], "score": 1000, "durationMs": 1000
        })
        self.assertEqual(status, 422)
        self.assertEqual(result["error"]["code"], "IMPLAUSIBLE_SCORE")

    def test_08_tournament_eligibility_and_duplicate_protection(self):
        client = Client(self.host, self.port)
        client.login()
        status, data = client.request("POST", "/api/tournaments/register", {"tournamentId": "t_aurora"})
        self.assertEqual(status, 201)
        status, data = client.request("POST", "/api/tournaments/register", {"tournamentId": "t_aurora"})
        self.assertEqual(status, 409)
        self.assertEqual(data["error"]["code"], "ALREADY_REGISTERED")

    def test_09_offline_tick_is_idempotent(self):
        with app.db(transaction=True) as con:
            con.execute("UPDATE pets SET last_tick_at=? WHERE user_id='usr_plus'", (app.iso(app.utcnow() - timedelta(hours=3)),))
        client = Client(self.host, self.port)
        client.login()
        _, first = client.request("GET", "/api/bootstrap")
        _, second = client.request("GET", "/api/bootstrap")
        self.assertAlmostEqual(first["pet"]["stats"]["hunger"], second["pet"]["stats"]["hunger"], places=1)

    def test_10_admin_membership_update_is_audited(self):
        client = Client(self.host, self.port)
        client.login("admin@customagotchi.local")
        status, data = client.request("PATCH", "/api/admin/users", {"userId": "usr_free", "membership": "plus", "billingCycle": "monthly"})
        self.assertEqual(status, 200)
        _, overview = client.request("GET", "/api/admin/overview")
        self.assertTrue(any(log["action"] == "membership.update" for log in overview["logs"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
