"""Private batch adapter; shared protected transport owns writes and verification."""
import json
import sys
import time
from main import operations, connection
from deployment import Deployment, serve


def run(payload, ops, transport=None):
    items = payload['files']
    if not isinstance(items, list) or not items:
        raise ValueError('A nonempty file plan is required')
    transport = transport or Deployment(ops)
    transport.total = len(items)
    result = {'status': 'verified', 'files': [dict(file=item['file'], status='not-executed') for item in items]}
    started = time.monotonic()
    index, stage = 0, 'local-check'
    try:
        destinations = set()
        for index, item in enumerate(items):
            transport.index = index + 1
            target = ops.remote(item['remotePath'])
            if target in destinations:
                raise ValueError('Duplicate destination')
            destinations.add(target)
            transport.check_local(item)
        stage = 'compare'
        baseline = []
        for index, item in enumerate(items):
            transport.index = index + 1
            baseline.append(transport.read(item['remotePath'], validate_text=True))
        for index, item in enumerate(items):
            transport.index = index + 1
            stage = 'upload-verify'
            unchanged = baseline[index] == item['sha256']
            if unchanged:
                transport.check_local(item)
                if transport.read(item['remotePath'], 'final-verify') != item['sha256']:
                    raise ValueError('Unchanged file changed since comparison')
            else:
                transport.put(item, baseline[index])
            result['files'][index] = dict(file=item['file'], status='unchanged' if unchanged else 'uploaded',
                                         sha256=item['sha256'], verified=True)
            transport.emit(dict(type='file-result', index=index, result=result['files'][index]))
    except Exception as error:
        result.update(status='upload-failed', failedStage=stage, failedFile=items[index]['file'],
                      errorType=type(error).__name__)
        result['files'][index] = dict(file=items[index]['file'], status=getattr(error, 'status', 'failed'),
                                     reason=getattr(error, 'reason', 'preflight-or-verification-failed'))
    result['elapsedMs'] = round((time.monotonic() - started) * 1000)
    result['transport'] = transport.evidence()
    return result


if __name__ == '__main__':
    try:
        ops = operations()
        transport = Deployment(ops)
        if '--session' in sys.argv:
            serve(lambda payload: run(payload, ops, transport), transport, connection, sys.stdin, sys.stdout)
        else:
            result = run(json.load(sys.stdin), ops, transport)
            print(json.dumps(result, ensure_ascii=True))
            sys.exit(0 if result['status'] == 'verified' else 1)
    finally:
        connection.close()
