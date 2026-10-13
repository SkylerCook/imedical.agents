"""Shared, sequential deployment transport. No SSH commands or implicit reconnects."""
import base64
import codecs
import hashlib
import json
import posixpath
import time
from contextlib import contextmanager


class DeploymentFailure(ValueError):
    def __init__(self, status, reason):
        self.status, self.reason = status, reason
        super().__init__(reason)


class Stream:
    def __init__(self, stream, counts):
        self.stream, self.counts = stream, counts

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.stream.close()

    def read(self, *args):
        value = self.stream.read(*args)
        self.counts['readBytes'] += len(value)
        return value

    def write(self, value):
        self.stream.write(value)
        self.counts['writeBytes'] += len(value)


class Channel:
    def __init__(self, channel, counts):
        self.channel, self.counts = channel, counts

    def __getattr__(self, name):
        return getattr(self.channel, name)

    def file(self, target, mode):
        self.counts['writes' if 'w' in mode else 'reads'] += 1
        return Stream(self.channel.file(target, mode), self.counts)


class Deployment:
    def __init__(self, ops, emit=lambda event: None):
        self.ops, self.emit, self.channel = ops, emit, None
        self.timings = {}
        self.counts = dict(connections=0, reads=0, writes=0, readBytes=0, writeBytes=0)
        self.temporary = set()
        self.index, self.total = 0, 0

    @contextmanager
    def phase(self, stage):
        event = dict(type='progress', stage=stage, fileIndex=self.index, total=self.total)
        self.emit(dict(event, state='start'))
        started = time.monotonic()
        try:
            yield
        finally:
            elapsed = round((time.monotonic() - started) * 1000, 3)
            self.timings[stage] = self.timings.get(stage, 0) + elapsed
            self.emit(dict(event, state='end', elapsedMs=elapsed, transport=self.evidence()))

    def evidence(self):
        return dict(timings=dict(self.timings), counts=dict(self.counts), cleanupPending=sorted(self.temporary))

    def connect(self):
        if self.channel is None:
            with self.phase('connect'):
                self.counts['connections'] += 1
                self.channel = Channel(self.ops.get_sftp(), self.counts)
        return self.channel  # Never invoke the reconnecting connection getter a second time.

    def temporary_event(self, target, owned):
        (self.temporary.add if owned else self.temporary.discard)(target)
        self.emit(dict(type='temporary', path=target, owned=owned))

    def read(self, target, stage='compare', content=False, validate_text=False):
        channel = self.connect()
        with self.phase(stage):
            target = self.ops.remote(target)
            self.ops.check_remote(channel, target)
            try:
                with channel.file(target, 'rb') as stream:
                    if not content:
                        if validate_text:
                            decoder, digest, size = codecs.getincrementaldecoder('utf-8-sig')(), hashlib.sha256(), 0
                            while True:
                                chunk = stream.read(1024 * 1024)
                                size += len(chunk)
                                if size > 16 * 1024 * 1024:
                                    raise ValueError('File too large')
                                text = decoder.decode(chunk, final=not chunk)
                                if '\x00' in text or '\ufffd' in text:
                                    raise ValueError('Binary or invalid remote text')
                                digest.update(chunk)
                                if not chunk:
                                    return digest.hexdigest()
                        return self.ops.digest(stream)
                    value = stream.read(16 * 1024 * 1024 + 1)
                    if len(value) > 16 * 1024 * 1024:
                        raise ValueError('File too large')
                    return value
            except FileNotFoundError:
                return None

    def check_local(self, item):
        with self.phase('local-check'):
            source = self.ops.local(item['localPath'])
            self.ops.remote(item['remotePath'])
            with open(source, 'rb') as stream:
                if self.ops.digest(stream) != item['sha256']:
                    raise ValueError('Local source changed')
            return source

    def put(self, item, expected):
        attempted = False
        def replacing():
            nonlocal attempted
            attempted = True
        def check_version(stage):
            if self.read(item['remotePath'], stage) != expected:
                raise DeploymentFailure('failed', 'remote-changed')
        try:
            source = self.check_local(item)
            check_version('before-upload')
            channel = self.connect()
            self.ops.ensure_dir(channel, posixpath.dirname(item['remotePath']), [])
            self.ops.transfer(channel, source, item['remotePath'], expected_sha256=item['sha256'],
                              before_replace=lambda: check_version('before-replace'), phase=self.phase,
                              replacing=replacing, temporary_event=self.temporary_event)
            actual = self.read(item['remotePath'], 'final-verify')
            if actual != item['sha256']:
                raise DeploymentFailure('failed', 'readback-mismatch')
            return dict(status='verified', verification='final-target-sha256', sha256=actual,
                        remotePath=item['remotePath'])
        except DeploymentFailure:
            raise
        except Exception:
            raise DeploymentFailure('failed-or-unknown' if attempted else 'failed', 'transfer-failed') from None

    def request(self, payload):
        self.index, self.total = payload.get('fileIndex', 1), payload.get('total', 1)
        if payload['mode'] == 'read':
            value = self.read(payload['remotePath'], content=True)
            return dict(status='verified', content=None if value is None else base64.b64encode(value).decode('ascii'))
        if payload['mode'] != 'put':
            raise ValueError('Unsupported operation')
        return self.put(payload, payload['expected'])


def serve(handler, transport, connection, reader, writer):
    """Private NDJSON protocol. First failed operation ends the session."""
    def send(value):
        writer.write(json.dumps(value, ensure_ascii=True) + '\n')
        writer.flush()
    transport.emit = send
    send(dict(type='ready'))
    try:
        while True:
            line = reader.readline(4 * 1024 * 1024 + 1)
            if not line:
                return
            request_id = None
            try:
                if len(line) > 4 * 1024 * 1024:
                    raise ValueError('Request too large')
                payload = json.loads(line)
                request_id = payload['id']
                result = handler(payload)
            except Exception as error:
                result = dict(status='failed-or-unknown', fileStatus=getattr(error, 'status', 'failed'),
                              reason=getattr(error, 'reason', 'worker-failed'))
            send(dict(result, type='result', id=request_id, transport=transport.evidence()))
            if result['status'] != 'verified':
                return
    finally:
        connection.close()
