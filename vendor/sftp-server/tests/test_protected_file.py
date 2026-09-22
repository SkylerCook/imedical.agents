import base64
import hashlib
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
from test_operations import FakeSFTP, Operations

spec = importlib.util.spec_from_file_location('protected_file', Path(__file__).resolve().parents[1] / 'src/protected-file.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class ProtectedTests(unittest.TestCase):
    def test_snapshot_conditional_write_and_drift(self):
        with tempfile.TemporaryDirectory(prefix='guard-file-') as root:
            source = Path(root) / 'artifact.js'
            source.write_bytes(b'new')
            sftp = FakeSFTP()
            sftp.files['/web/page.js'] = b'old'
            ops = Operations(root, '/web', [], lambda: sftp, Mock())
            result = worker.run({'mode':'read','remotePath':'/web/page.js'}, ops)
            self.assertEqual(base64.b64decode(result['content']), b'old')
            payload = {'mode':'put','remotePath':'/web/page.js','localPath':str(source),'expected':hashlib.sha256(b'old').hexdigest(),'sha256':hashlib.sha256(b'new').hexdigest()}
            worker.run(payload, ops)
            self.assertEqual(sftp.files['/web/page.js'], b'new')
            count = len(sftp.actions)
            with self.assertRaises(ValueError):
                worker.run(payload, ops)
            self.assertEqual(len(sftp.actions), count)
