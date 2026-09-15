"""Private stdio worker for deploy-frontend.js; not an independent deployment API."""
import json
import sys
import time
from main import operations


def run(payload, ops):
    items = payload['files']
    if not isinstance(items, list) or not items:
        raise ValueError('A nonempty file plan is required')
    # All local validation precedes network writes.
    for item in items:
        source = ops.local(item['localPath'])
        ops.remote(item['remotePath'])
        with open(source, 'rb') as stream:
            if ops.digest(stream) != item['sha256']:
                raise ValueError('Local source changed since planning')
    sftp = ops.get_sftp()
    for item in items:
        ops.check_remote(sftp, item['remotePath'])
    result = {'status': 'verified', 'files': []}
    for item in items:
        start = time.monotonic()
        try:
            unchanged = False
            try:
                with sftp.file(item['remotePath'], 'rb') as stream:
                    unchanged = ops.digest(stream) == item['sha256']
            except FileNotFoundError:
                pass
            if not unchanged:
                uploaded = ops.upload({'local_file_path': item['localPath'], 'remote_file_path': item['remotePath']})
                if uploaded['sha256'] != item['sha256']:
                    raise ValueError('Local source changed during deployment')
                with sftp.file(item['remotePath'], 'rb') as stream:
                    if ops.digest(stream) != item['sha256']:
                        raise ValueError('Final remote readback mismatch')
            result['files'].append({'file': item['file'], 'status': 'unchanged' if unchanged else 'uploaded',
                                    'sha256': item['sha256'], 'elapsedMs': round((time.monotonic()-start)*1000)})
        except Exception as error:
            result['status'] = 'upload-failed'
            result['files'].append({'file': item['file'], 'status': 'failed-or-unknown', 'errorType': type(error).__name__})
            break
    return result


if __name__ == '__main__':
    # operations() uses the same lazy, bounded Connection as the MCP server.
    from main import connection
    try:
        result = run(json.load(sys.stdin), operations())
    except Exception as error:
        result = {'status': 'upload-failed', 'errorType': type(error).__name__,
                  'message': 'Check source paths, Python dependencies, configured roots and trusted SSH key; no retry made'}
    finally:
        connection.close()
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result['status'] == 'verified' else 1)
