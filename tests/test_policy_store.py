"""Deterministic local-policy security and persistence tests (stdlib only)."""
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "native"))
import policy_store as store


class NativePolicyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="router-policy-unit-")
        self.original_dir = store.STATE_DIR
        self.original_file = store.POLICY_PATH
        store.STATE_DIR = Path(self.temp.name) / "state"
        store.POLICY_PATH = store.STATE_DIR / "rules.json"

    def tearDown(self):
        store.STATE_DIR, store.POLICY_PATH = self.original_dir, self.original_file
        self.temp.cleanup()

    def test_empty_and_stable_default(self):
        self.assertEqual(store.read_policy()["rules"], [])
        self.assertEqual(store.read_policy()["revision"], 0)
        self.assertFalse(store.read_policy()["autoDetect"])
        self.assertFalse(store.read_policy()["autoRetry"])

    def test_country_and_domain_validation(self):
        self.assertEqual(store.country(" nl "), "NL")
        self.assertEqual(store.domain("HTTPS://WWW.Example.COM/a"), "www.example.com")
        for value in ("localhost", "127.0.0.1", "ftp://example.com", "bad domain.com",
                      "http://admin:pass@example.com", "example.local", "x..com"):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    store.domain(value)
        for value in ("ZZZ", "1!", ""):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    store.country(value)

    def test_atomic_rule_save_and_file_permissions(self):
        p = store.read_policy()
        p["rules"].append({"domain": "site.example.com", "country": "CH",
                           "subdomains": True, "source": "manual"})
        p["revision"] = 10
        saved = store.save_policy(p)
        self.assertEqual(store.read_policy(), saved)
        self.assertEqual(stat.S_IMODE(store.POLICY_PATH.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(store.STATE_DIR.stat().st_mode), 0o700)

    def test_stale_policy_cannot_overwrite_newer(self):
        p = store.read_policy()
        p["revision"] = 9
        store.save_policy(p)
        stale = dict(p, revision=8, enabled=False)
        self.assertTrue(store.save_policy(stale)["enabled"])
        self.assertTrue(store.read_policy()["enabled"])

    def test_duplicate_domains_and_symlinks_rejected(self):
        p = store.read_policy()
        p["rules"] = [{"domain": "a.example.com", "country": "NL"},
                      {"domain": "a.example.com", "country": "US"}]
        with self.assertRaises(ValueError):
            store.save_policy(p)
        store.STATE_DIR.mkdir(parents=True)
        target = Path(self.temp.name) / "other"
        target.write_text("{}")
        store.POLICY_PATH.symlink_to(target)
        with self.assertRaises(ValueError):
            store.read_policy()


if __name__ == "__main__":
    unittest.main(verbosity=2)
