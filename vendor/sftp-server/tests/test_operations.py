import io
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from operations import Operations, ignored


class FakeSFTP:
    def __init__(self):
        self.files = {}
        self.dirs = {'/', '/web'}
        self.links = set()
        self.fail_rename = False
        self.corrupt = False
        self.denied = set()
        self.actions = []

    def lstat(self, path):
        if path in self.links:
            return SimpleNamespace(st_mode=stat.S_IFLNK)
        if path in self.dirs:
            return SimpleNamespace(st_mode=stat.S_IFDIR)
        if path not in self.files:
            raise FileNotFoundError(path)
        return SimpleNamespace(st_mode=stat.S_IFREG, st_size=len(self.files[path]), st_mtime=1)

    stat = lstat

    def mkdir(self, path):
        if path in self.denied:
            raise PermissionError(path)
        self.actions.append(('mkdir', path))
        self.dirs.add(path)

    def file(self, path, mode):
        if 'w' not in mode:
            return io.BytesIO(self.files[path])
        if path in self.files:
            raise FileExistsError(path)
        owner = self
        self.actions.append(('write', path))

        class Writer(io.BytesIO):
            def close(inner):
                if not inner.closed:
                    owner.files[path] = inner.getvalue() + (b'corruption' if owner.corrupt else b'')
                super().close()
        return Writer()

    def utime(self, path, times):
        pass

    def chmod(self, path, mode):
        self.actions.append(('chmod', mode))

    def posix_rename(self, source, target):
        if self.fail_rename:
            raise OSError('posix-rename unsupported')
        self.files[target] = self.files.pop(source)
        self.actions.append(('rename', target))

    def remove(self, path):
        self.actions.append(('remove', path))
        del self.files[path]


class OperationsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='sftp-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'sample.js'
        self.source.write_bytes(b'new content')
        self.sftp = FakeSFTP()
        self.ops = Operations(str(self.root), '/web', ['.git/', '*.log'], lambda: self.sftp, Mock())

    def test_windows_ignore_patterns(self):
        for path in ['.git\\objects\\abc', 'nested/.git/config', 'nested/debug.log']:
            self.assertTrue(ignored(path, self.ops.patterns))
        self.assertFalse(ignored('legit.git/script.js', self.ops.patterns))

    def test_escape_rejected_before_network(self):
        self.ops.get_sftp = Mock(side_effect=AssertionError('network'))
        for target in ['/outside/file', '/web/../outside', 'relative', '/web\\file']:
            with self.assertRaises(ValueError):
                self.ops.upload({'local_file_path': str(self.source), 'remote_file_path': target})
        with self.assertRaises(ValueError):
            self.ops.upload({'local_file_path': str(self.root.parent / 'outside.js')})
        self.ops.get_sftp.assert_not_called()

    def test_atomic_upload_and_readback(self):
        self.sftp.files['/web/sample.js'] = b'old'
        result = self.ops.upload({'local_file_path': str(self.source)})
        self.assertEqual(result['status'], 'uploaded')
        self.assertEqual(self.sftp.files, {'/web/sample.js': b'new content'})
        self.assertEqual(len(result['sha256']), 64)

    def test_failed_replace_preserves_original_and_cleans_temp(self):
        self.sftp.files['/web/sample.js'] = b'old'
        self.sftp.fail_rename = True
        with self.assertRaises(OSError):
            self.ops.upload({'local_file_path': str(self.source)})
        self.assertEqual(self.sftp.files, {'/web/sample.js': b'old'})

    def test_bad_digest_never_replaces_original(self):
        self.sftp.files['/web/sample.js'] = b'old'
        self.sftp.corrupt = True
        with self.assertRaisesRegex(ValueError, 'SHA-256'):
            self.ops.upload({'local_file_path': str(self.source)})
        self.assertEqual(self.sftp.files, {'/web/sample.js': b'old'})

    def test_symlink_destination_rejected(self):
        self.sftp.links.add('/web/sample.js')
        with self.assertRaisesRegex(ValueError, 'symbolic'):
            self.ops.upload({'local_file_path': str(self.source)})
        self.assertFalse(self.sftp.actions)

    def test_directory_destination_rejected_without_write(self):
        self.sftp.dirs.add('/web/sample.js')
        with self.assertRaises(ValueError):
            self.ops.upload({'local_file_path': str(self.source)})
        self.assertFalse(self.sftp.actions)

    def test_missing_ancestors_outside_remote_root_are_not_created(self):
        self.ops.remote_root = '/missing/root'
        with self.assertRaises(ValueError):
            self.ops.upload({'local_file_path': str(self.source)})
        self.assertFalse(self.sftp.actions)

    def test_permission_error_not_success(self):
        self.sftp.denied.add('/web/denied')
        with self.assertRaises(OSError):
            self.ops.upload({'local_file_path': str(self.source), 'remote_file_path': '/web/denied/sample.js'})
        self.assertFalse(self.sftp.files)

    def test_sha_sync_detects_same_size_changes_and_dry_run_no_writes(self):
        self.sftp.files['/web/sample.js'] = b'old content'
        result = self.ops.sync({'dry_run': True})
        self.assertEqual(result['planned'], ['sample.js'])
        self.assertFalse(self.sftp.actions)
        result = self.ops.sync({})
        self.assertEqual(len(result['uploaded']), 1)
        self.assertEqual(self.ops.sync({})['unchanged'], ['sample.js'])

    def test_ignored_directories_pruned(self):
        (self.root / '.git').mkdir()
        (self.root / '.git' / 'config').write_text('private')
        result = self.ops.sync({})
        self.assertIn('.git', result['ignored'])
        self.assertNotIn('/web/.git/config', self.sftp.files)

    def test_invalid_directory_is_error(self):
        with self.assertRaises(ValueError):
            self.ops.sync({'local_dir': str(self.root / 'missing')})

    def test_empty_and_invalid_utf8_byte_count(self):
        self.sftp.files['/web/empty'] = b''
        self.assertEqual(self.ops.read({'remote_file_path': '/web/empty'})['read_bytes'], 0)
        self.sftp.files['/web/raw'] = b'\xff'
        self.assertEqual(self.ops.read({'remote_file_path': '/web/raw'})['read_bytes'], 1)

    def test_invalid_read_arguments(self):
        for field in ['offset', 'limit', 'max_size']:
            with self.assertRaises(ValueError):
                self.ops.read({'remote_file_path': '/web/a', field: -1})

    def test_commands_disabled_by_default(self):
        with self.assertRaises(ValueError):
            self.ops.execute({'command': 'pwd'})
        self.ops.get_ssh.assert_not_called()

    def test_command_drains_both_streams_before_exit(self):
        channel = Mock()
        out, err = [b'a' * 65536, b'b' * 65536], [b'error']
        channel.recv_ready.side_effect = lambda: bool(out)
        channel.recv_stderr_ready.side_effect = lambda: bool(err)
        channel.recv.side_effect = lambda n: out.pop(0)
        channel.recv_stderr.side_effect = lambda n: err.pop(0)
        channel.exit_status_ready.return_value = True
        channel.recv_exit_status.side_effect = lambda: 0 if not out and not err else self.fail('undrained')
        ssh = Mock()
        ssh.exec_command.return_value = (Mock(), Mock(channel=channel), Mock())
        self.ops.get_ssh = lambda: ssh
        self.ops.allow_commands = True
        result = self.ops.execute({'command': 'pwd', 'working_directory': "/web/a'b"})
        self.assertEqual(len(result['stdout']), 131072)
        self.assertEqual(result['stderr'], 'error')
        self.assertIn("'\"'\"'", ssh.exec_command.call_args.args[0])
        channel.close.assert_called_once()


if __name__ == '__main__':
    unittest.main()
