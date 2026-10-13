"""Private snapshot/conditional-write adapter. Legacy single-request input retained."""
import json
import sys
from main import operations, connection
from deployment import Deployment, serve


def run(payload, ops):
    return Deployment(ops).request(payload)


if __name__ == '__main__':
    try:
        transport = Deployment(operations())
        if '--session' in sys.argv:
            serve(transport.request, transport, connection, sys.stdin, sys.stdout)
        else:
            try:
                result = transport.request(json.load(sys.stdin))
            except Exception:
                result = {'status': 'failed-or-unknown'}
            print(json.dumps(result))
            sys.exit(0 if result['status'] == 'verified' else 1)
    finally:
        connection.close()
