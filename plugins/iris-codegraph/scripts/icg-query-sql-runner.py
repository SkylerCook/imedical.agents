#!/usr/bin/env python3
"""
icg-query.js 的 Python 查询执行器（降级方案）。
当运行环境 Node.js 未内置 node:sqlite 时，icg-query.js 通过本脚本执行 SQL。
用法：python icg-query-sql-runner.py <db_path>
通信协议：stdin 每行一个 JSON 对象 {"sql": "...", "params": [...]}，stdout 每行一个 JSON 数组结果。
"""

import json
import sqlite3
import sys


def main():
    if len(sys.argv) < 2:
        print('用法: python icg-query-sql-runner.py <db_path>', file=sys.stderr)
        sys.exit(1)

    db_path = sys.argv[1]
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            print(json.dumps({'error': f'JSON 解析失败: {e}'}))
            sys.stdout.flush()
            continue

        sql = req.get('sql', '')
        params = req.get('params', [])
        try:
            cur = conn.execute(sql, params)
            rows = [dict(r) for r in cur.fetchall()]
            print(json.dumps(rows, ensure_ascii=False))
        except Exception as e:
            print(json.dumps({'error': str(e)}))
        sys.stdout.flush()

    conn.close()


if __name__ == '__main__':
    main()
