import hashlib
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
from test_operations import FakeSFTP, Operations

spec = importlib.util.spec_from_file_location('upload_batch', Path(__file__).resolve().parents[1] / 'src/upload-batch.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class BatchTests(unittest.TestCase):
    def test_upload_then_skip_and_source_drift(self):
        with tempfile.TemporaryDirectory(prefix='frontend-batch-') as root:
            source = Path(root) / 'page.js'
            source.write_bytes(b'content')
            sftp = FakeSFTP()
            original = sftp.file
            def file(path, mode):
                if 'w' not in mode and path not in sftp.files:
                    raise FileNotFoundError(path)
                return original(path, mode)
            sftp.file = file
            getter = Mock(return_value=sftp)
            ops = Operations(root, '/web', [], getter, Mock())
            item = {'file':'page.js', 'localPath':str(source), 'remotePath':'/web/page.js', 'sha256':hashlib.sha256(b'content').hexdigest()}
            self.assertEqual(worker.run({'files':[item]}, ops)['files'][0]['status'], 'uploaded')
            count = len(sftp.actions)
            self.assertEqual(worker.run({'files':[item]}, ops)['files'][0]['status'], 'unchanged')
            self.assertEqual(count, len(sftp.actions))
            source.write_bytes(b'changed')
            getter.reset_mock()
            with self.assertRaises(ValueError):
                worker.run({'files':[item]}, ops)
            getter.assert_not_called()

    def test_failure_stops_remaining_files(self):
        with tempfile.TemporaryDirectory(prefix='frontend-batch-') as root:
            source = Path(root) / 'page.js'
            source.write_bytes(b'content')
            sftp = FakeSFTP()
            sftp.files['/web/page.js'] = b'old'
            sftp.fail_rename = True
            ops = Operations(root, '/web', [], lambda:sftp, Mock())
            item = {'file':'page.js', 'localPath':str(source), 'remotePath':'/web/page.js', 'sha256':hashlib.sha256(b'content').hexdigest()}
            result = worker.run({'files':[item,item]}, ops)
            self.assertEqual(result['status'], 'upload-failed')
            self.assertEqual(len(result['files']), 1)
            self.assertEqual(sftp.files['/web/page.js'], b'old')
