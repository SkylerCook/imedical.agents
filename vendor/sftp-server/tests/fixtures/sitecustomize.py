"""Explicit PYTHONPATH fixture for CLI tests; never loaded by production defaults."""
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
import paramiko

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_operations import FakeSFTP


class TestSFTP(FakeSFTP):
    def __init__(self):
        super().__init__()
        self.dirs.add('/web/css')
        self.files = {'/web/css/a.css': b'old', '/web/css/b.css': b'old'}
        count = int(os.getenv('SFTP_TEST_UNCHANGED', '0'))
        for name in ['a', 'b'][:count]:
            self.files['/web/css/'+name+'.css'] = b'new'
        self.channel = Mock(closed=False)

    def get_channel(self):
        return self.channel

    def close(self):
        self.channel.closed = True

    def file(self, target, mode):
        if 'w' not in mode and target not in self.files:
            raise FileNotFoundError(target)
        return super().file(target, mode)

    def remove(self, target):
        if target not in self.files:
            raise FileNotFoundError(target)
        return super().remove(target)

    def posix_rename(self, source, target):
        super().posix_rename(source, target)
        if os.getenv('SFTP_TEST_CORRUPT') == '1':
            self.files[target] = b'corrupt'


def client():
    value = Mock()
    value.get_transport.return_value = Mock(is_active=lambda: True, is_authenticated=lambda: True)
    value.open_sftp.return_value = TestSFTP()
    return value


paramiko.SSHClient = client
