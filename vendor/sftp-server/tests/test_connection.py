import os
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
import main


class ConnectionTests(unittest.TestCase):
    def test_explicit_host_store_overrides_stale_system_store(self):
        client = Mock()
        with patch.dict(os.environ, {'TARGET_HOST': 'example.invalid', 'TARGET_USERNAME': 'test',
                                    'TARGET_KNOWN_HOSTS': 'trusted-hosts'}, clear=True), \
             patch.object(main.paramiko, 'SSHClient', return_value=client):
            conn = main.Connection()
            conn.get_ssh()
            client.load_system_host_keys.assert_not_called()
            client.load_host_keys.assert_called_once()
            self.assertIsInstance(client.set_missing_host_key_policy.call_args.args[0], main.paramiko.RejectPolicy)
            conn.close()

    def test_system_store_used_when_no_explicit_store(self):
        client = Mock()
        with patch.dict(os.environ, {'TARGET_HOST': 'example.invalid', 'TARGET_USERNAME': 'test'}, clear=True), \
             patch.object(main.paramiko, 'SSHClient', return_value=client):
            conn = main.Connection()
            conn.get_ssh()
            client.load_system_host_keys.assert_called_once()
            client.load_host_keys.assert_not_called()
            conn.close()

    def test_failed_connection_closed(self):
        client = Mock()
        client.connect.side_effect = RuntimeError('failed')
        with patch.dict(os.environ, {'TARGET_HOST': 'example.invalid', 'TARGET_USERNAME': 'test'}, clear=True), \
             patch.object(main.paramiko, 'SSHClient', return_value=client):
            with self.assertRaises(RuntimeError):
                main.Connection().get_ssh()
            client.close.assert_called_once()


class FingerprintTests(unittest.TestCase):
    def test_exact_match_without_persistence(self):
        key = Mock()
        key.asbytes.return_value = b'test-key'
        digest = main.base64.b64encode(main.hashlib.sha256(b'test-key').digest()).decode().rstrip('=')
        client = Mock()
        main.FingerprintPolicy('SHA256:' + digest).missing_host_key(client, 'example.invalid', key)
        self.assertEqual(client.mock_calls, [])
        with self.assertRaises(main.paramiko.SSHException):
            main.FingerprintPolicy('SHA256:' + 'A'*43).missing_host_key(client, 'example.invalid', key)

    def test_invalid_pin_and_ambiguous_trust_rejected(self):
        with self.assertRaises(ValueError):
            main.FingerprintPolicy('invalid')
        with patch.dict(os.environ, {'TARGET_HOST': 'example.invalid', 'TARGET_USERNAME': 'test',
            'TARGET_KNOWN_HOSTS': 'trusted-hosts', 'TARGET_HOST_KEY_SHA256': 'SHA256:' + 'A'*43}, clear=True), \
            patch.object(main.paramiko, 'SSHClient') as factory:
            with self.assertRaises(ValueError):
                main.Connection().get_ssh()
            factory.return_value.connect.assert_not_called()

    def test_pin_ignores_system_store(self):
        with patch.dict(os.environ, {'TARGET_HOST': 'example.invalid', 'TARGET_USERNAME': 'test',
            'TARGET_HOST_KEY_SHA256': 'SHA256:' + 'A'*43}, clear=True), \
            patch.object(main.paramiko, 'SSHClient') as factory:
            conn = main.Connection()
            conn.get_ssh()
            factory.return_value.load_system_host_keys.assert_not_called()
            factory.return_value.load_host_keys.assert_not_called()
            self.assertIsInstance(factory.return_value.set_missing_host_key_policy.call_args.args[0], main.FingerprintPolicy)
            conn.close()
