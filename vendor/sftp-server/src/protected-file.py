"""Private snapshot/conditional-write adapter. No automatic retry."""
import base64
import hashlib
import json
import sys
from main import operations, connection

def run(payload, ops):
    remote = ops.remote(payload['remotePath'])
    sftp = ops.get_sftp()
    ops.check_remote(sftp, remote)
    try:
        with sftp.file(remote, 'rb') as stream:
            current = stream.read(16 * 1024 * 1024 + 1)
        if len(current) > 16 * 1024 * 1024:
            raise ValueError('File too large')
    except FileNotFoundError:
        current = None
    if payload['mode'] == 'read':
        return {'status': 'verified', 'content': None if current is None else base64.b64encode(current).decode('ascii')}
    if payload['mode'] != 'put':
        raise ValueError('Unsupported mode')
    actual = None if current is None else hashlib.sha256(current).hexdigest()
    if actual != payload['expected']:
        raise ValueError('Remote changed before upload')
    local = ops.local(payload['localPath'])
    with open(local, 'rb') as stream:
        if ops.digest(stream) != payload['sha256']:
            raise ValueError('Artifact changed')
    result = ops.upload({'local_file_path': local, 'remote_file_path': remote})
    if result['sha256'] != payload['sha256']:
        raise ValueError('Upload mismatch')
    return {'status': 'verified'}

if __name__ == '__main__':
    try:
        result = run(json.load(sys.stdin), operations())
    except Exception:
        result = {'status': 'failed-or-unknown'}
    finally:
        connection.close()
    print(json.dumps(result))
    sys.exit(0 if result['status'] == 'verified' else 1)
