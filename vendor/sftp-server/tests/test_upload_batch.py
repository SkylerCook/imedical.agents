import hashlib
import importlib.util
import tempfile
import unittest
import io
import json
from pathlib import Path
from unittest.mock import Mock
from test_operations import FakeSFTP, Operations
from deployment import Deployment, serve

spec = importlib.util.spec_from_file_location('upload_batch', Path(__file__).resolve().parents[1] / 'src/upload-batch.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class BatchTests(unittest.TestCase):
    def fixture(self):
        temp = tempfile.TemporaryDirectory(prefix='batch-safety-')
        self.addCleanup(temp.cleanup)
        source = Path(temp.name) / 'sample.js'
        source.write_bytes(b'new')
        sftp = FakeSFTP()
        sftp.files = {'/web/a.js': b'old', '/web/b.js': b'old'}
        getter = Mock(return_value=sftp)
        ops = Operations(temp.name, '/web', [], getter, Mock())
        items = [dict(file=name, localPath=str(source), remotePath='/web/'+name,
                      sha256=hashlib.sha256(b'new').hexdigest()) for name in ['a.js', 'b.js']]
        return sftp, ops, items, getter

    def test_upload_time_conflict_preserves_other_editor_and_stops(self):
        sftp, ops, items, getter = self.fixture()
        original = sftp.file
        def file(target, mode):
            if target.startswith('/web/a.js.imedical-') and mode == 'rb':
                sftp.files['/web/a.js'] = b'other-editor'
            return original(target, mode)
        sftp.file = file
        result = worker.run({'files':items}, ops)
        self.assertEqual([f['status'] for f in result['files']], ['failed', 'not-executed'])
        self.assertEqual(sftp.files, {'/web/a.js': b'other-editor', '/web/b.js': b'old'})
        getter.assert_called_once()

    def test_final_mismatch_stops_later_writes_without_duplicate_results(self):
        sftp, ops, items, _ = self.fixture()
        original = sftp.posix_rename
        def rename(source, target):
            original(source, target)
            sftp.files[target] = b'corrupt'
        sftp.posix_rename = rename
        result = worker.run({'files':items}, ops)
        self.assertEqual([f['status'] for f in result['files']], ['failed', 'not-executed'])
        self.assertEqual(sftp.files['/web/b.js'], b'old')
        self.assertEqual([a for a in sftp.actions if a[0]=='rename'], [('rename','/web/a.js')])

    def test_source_changed_after_local_check_never_replaces_target(self):
        sftp, ops, items, _ = self.fixture()
        original = sftp.file
        def file(target, mode):
            if mode == 'wx':
                Path(items[0]['localPath']).write_bytes(b'changed')
            return original(target, mode)
        sftp.file = file
        result = worker.run({'files':items}, ops)
        self.assertEqual([f['status'] for f in result['files']], ['failed', 'not-executed'])
        self.assertEqual(sftp.files, {'/web/a.js': b'old', '/web/b.js': b'old'})

    def test_remote_encoding_preflight_is_preserved_before_any_write(self):
        for content in [b'\xff', b'\x00', '\ufffd'.encode('utf-8')]:
            with self.subTest(content=content):
                sftp, ops, items, _ = self.fixture()
                sftp.files['/web/b.js'] = content
                result = worker.run({'files':items}, ops)
                self.assertEqual([f['status'] for f in result['files']], ['not-executed', 'failed'])
                self.assertFalse(sftp.actions)

    def test_session_failure_stops_reading_remaining_requests_and_closes(self):
        sftp, ops, items, getter = self.fixture()
        payloads = [dict(items[0], id=1, mode='put', expected='wrong'),
                    dict(items[1], id=2, mode='put', expected=hashlib.sha256(b'old').hexdigest())]
        transport, conn, output = Deployment(ops), Mock(), io.StringIO()
        serve(transport.request, transport, conn, io.StringIO(''.join(json.dumps(x)+'\n' for x in payloads)), output)
        results = [json.loads(x) for x in output.getvalue().splitlines() if json.loads(x)['type']=='result']
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['fileStatus'], 'failed')
        self.assertFalse(sftp.actions)
        getter.assert_called_once()
        conn.close.assert_called_once()

    def test_lost_rename_response_is_unknown_and_keeps_prior_evidence(self):
        sftp, ops, items, getter = self.fixture()
        original = sftp.posix_rename
        def rename(source, target):
            original(source, target)
            if target == '/web/b.js':
                raise OSError('response lost')
        sftp.posix_rename = rename
        result = worker.run({'files':items}, ops)
        self.assertEqual([f['status'] for f in result['files']], ['uploaded', 'failed-or-unknown'])
        self.assertTrue(result['files'][0]['verified'])
        self.assertEqual(sftp.files['/web/b.js'], b'new')
        getter.assert_called_once()

    def test_interruption_keeps_exact_owned_temporary_for_recovery(self):
        sftp, ops, items, getter = self.fixture()
        sftp.posix_rename = Mock(side_effect=OSError('disconnected'))
        sftp.remove = Mock(side_effect=OSError('disconnected'))
        result = worker.run({'files':items}, ops)
        self.assertEqual(result['files'][0]['status'], 'failed-or-unknown')
        pending = result['transport']['cleanupPending']
        self.assertEqual(len(pending), 1)
        self.assertTrue(pending[0].startswith('/web/a.js.imedical-'))
        self.assertIn(pending[0], sftp.files)
        getter.assert_called_once()

    def test_changed_mixed_unchanged_batches_count_writes_and_reads(self):
        for unchanged, writes in [(0,2), (1,1), (2,0)]:
            with self.subTest(unchanged=unchanged):
                sftp, ops, items, getter = self.fixture()
                for item in items[:unchanged]:
                    sftp.files[item['remotePath']] = b'new'
                result = worker.run({'files':items}, ops)
                self.assertEqual(result['status'], 'verified')
                self.assertEqual(result['transport']['counts']['writes'], writes)
                self.assertEqual(result['transport']['counts']['writeBytes'], 3*writes)
                self.assertGreater(result['transport']['counts']['readBytes'], 0)
                self.assertIn('final-verify', result['transport']['timings'])
                getter.assert_called_once()

    def test_persistent_protected_session_reuses_connection_and_closes(self):
        sftp, ops, items, getter = self.fixture()
        payloads = [dict(id=1, mode='read', remotePath='/web/a.js'),
                    dict(items[0], id=2, mode='put', expected=hashlib.sha256(b'old').hexdigest())]
        transport, conn, output = Deployment(ops), Mock(), io.StringIO()
        serve(transport.request, transport, conn, io.StringIO(''.join(json.dumps(x)+'\n' for x in payloads)), output)
        results = [json.loads(x) for x in output.getvalue().splitlines() if json.loads(x)['type']=='result']
        self.assertEqual([r['status'] for r in results], ['verified','verified'])
        self.assertEqual(results[-1]['verification'], 'final-target-sha256')
        getter.assert_called_once()
        conn.close.assert_called_once()

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
            self.assertEqual(worker.run({'files':[item]}, ops)['files'][0]['status'], 'failed')
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
            other = dict(item, file='other.js', remotePath='/web/other.js')
            sftp.files['/web/other.js'] = b'old'
            result = worker.run({'files':[item,other]}, ops)
            self.assertEqual(result['status'], 'upload-failed')
            self.assertEqual(len(result['files']), 2)
            self.assertEqual(result['files'][1]['status'], 'not-executed')
            self.assertEqual(sftp.files['/web/page.js'], b'old')

    def test_one_channel_and_immediate_final_verification(self):
        with tempfile.TemporaryDirectory(prefix='frontend-batch-') as root:
            sftp = FakeSFTP()
            events = []
            original_file = sftp.file
            original_rename = sftp.posix_rename
            def read(path, mode):
                events.append(('open', path, mode))
                return original_file(path, mode)
            def rename(source, target):
                events.append(('rename', target))
                return original_rename(source, target)
            sftp.file = read
            sftp.posix_rename = rename
            getter = Mock(return_value=sftp)
            ops = Operations(root, '/web', [], getter, Mock())
            items = []
            for name, remote in [('a.js', b'old'), ('b.js', b'new'), ('c.js', b'old')]:
                source = Path(root) / name
                source.write_bytes(b'new')
                sftp.files['/web/' + name] = remote
                items.append({'file':name, 'localPath':str(source), 'remotePath':'/web/'+name,
                              'sha256':hashlib.sha256(b'new').hexdigest()})
            result = worker.run({'files':items}, ops)
            self.assertEqual(result['status'], 'verified')
            self.assertEqual([f['status'] for f in result['files']], ['uploaded','unchanged','uploaded'])
            getter.assert_called_once()
            self.assertEqual([e[1] for e in events if e[0]=='rename'], ['/web/a.js','/web/c.js'])
            first_rename = events.index(('rename', '/web/a.js'))
            self.assertEqual(events[first_rename + 1], ('open', '/web/a.js', 'rb'))
            self.assertEqual(result['transport']['counts']['connections'], 1)
            self.assertEqual(result['transport']['counts']['writes'], 2)

    def test_remote_drift_blocks_write(self):
        with tempfile.TemporaryDirectory(prefix='frontend-batch-') as root:
            source = Path(root) / 'page.js'
            source.write_bytes(b'new')
            sftp = FakeSFTP()
            sftp.files['/web/page.js'] = b'old'
            original = sftp.file
            calls = 0
            def read(path, mode):
                nonlocal calls
                calls += 1
                if calls == 2:
                    sftp.files[path] = b'concurrent'
                return original(path, mode)
            sftp.file = read
            ops = Operations(root, '/web', [], lambda:sftp, Mock())
            item = {'file':'page.js','localPath':str(source),'remotePath':'/web/page.js',
                    'sha256':hashlib.sha256(b'new').hexdigest()}
            result = worker.run({'files':[item]}, ops)
            self.assertEqual(result['status'], 'upload-failed')
            self.assertEqual(sftp.actions, [])
            self.assertEqual(sftp.files['/web/page.js'], b'concurrent')
