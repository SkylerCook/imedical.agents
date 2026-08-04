#!/usr/bin/env python3
"""
IRISGraph SQLite 写入器
读取 iris-codegraph-build.js 生成的 graph-data.json，写入 .iris-codegraph/iris-codegraph.db
"""

import json
import os
import sqlite3
import sys


def init_db(conn):
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY,
            path TEXT NOT NULL UNIQUE,
            language TEXT,
            module TEXT,
            last_modified INTEGER
        );
        CREATE TABLE IF NOT EXISTS nodes (
            id INTEGER PRIMARY KEY,
            kind TEXT NOT NULL,
            name TEXT NOT NULL,
            qualified_name TEXT,
            file_path TEXT,
            start_line INTEGER,
            end_line INTEGER,
            signature TEXT,
            visibility TEXT,
            is_exported INTEGER,
            is_static INTEGER,
            docstring TEXT,
            language TEXT,
            module TEXT,
            metadata TEXT
        );
        CREATE TABLE IF NOT EXISTS edges (
            id INTEGER PRIMARY KEY,
            kind TEXT NOT NULL,
            source INTEGER NOT NULL,
            target INTEGER NOT NULL,
            file_path TEXT,
            start_line INTEGER,
            start_column INTEGER,
            end_column INTEGER,
            confidence REAL,
            metadata TEXT
        );
        CREATE TABLE IF NOT EXISTS project_metadata (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
        CREATE INDEX IF NOT EXISTS idx_nodes_qualified ON nodes(qualified_name);
        CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
        CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
    ''')
    conn.executescript('DELETE FROM files; DELETE FROM nodes; DELETE FROM edges; DELETE FROM project_metadata;')


def main():
    if len(sys.argv) < 2:
        print('用法: python write-sqlite.py <graph-data.json>', file=sys.stderr)
        sys.exit(1)

    data_path = sys.argv[1]
    output_dir = os.path.dirname(data_path)
    db_path = os.path.join(output_dir, 'iris-codegraph.db')

    with open(data_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    os.makedirs(output_dir, exist_ok=True)
    conn = sqlite3.connect(db_path)
    init_db(conn)

    cursor = conn.cursor()

    for f in data.get('files', []):
        cursor.execute(
            'INSERT INTO files (path, language, module, last_modified) VALUES (?, ?, ?, ?)',
            (f.get('path'), f.get('language'), f.get('module'), f.get('last_modified'))
        )

    node_id_map = {}
    for n in data.get('nodes', []):
        cursor.execute(
            '''INSERT INTO nodes
               (kind, name, qualified_name, file_path, start_line, end_line, signature, visibility, is_exported, is_static, docstring, language, module, metadata)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (
                n.get('kind'), n.get('name'), n.get('qualified_name'), n.get('file_path'),
                n.get('start_line'), n.get('end_line'), n.get('signature'), n.get('visibility'),
                1 if n.get('is_exported') else 0,
                1 if n.get('is_static') else 0,
                n.get('docstring'), n.get('language'), n.get('module'),
                json.dumps(n.get('metadata'), ensure_ascii=False) if n.get('metadata') else None
            )
        )
        node_id_map[n.get('qualified_name')] = cursor.lastrowid

    for e in data.get('edges', []):
        cursor.execute(
            '''INSERT INTO edges
               (kind, source, target, file_path, start_line, confidence, metadata)
               VALUES (?, ?, ?, ?, ?, ?, ?)''',
            (
                e.get('kind'), e.get('source'), e.get('target'), e.get('file_path'),
                e.get('start_line'),
                e.get('confidence') if e.get('confidence') is not None else 1.0,
                json.dumps(e.get('metadata'), ensure_ascii=False) if e.get('metadata') else None
            )
        )

    for k, v in data.get('metadata', {}).items():
        cursor.execute('INSERT INTO project_metadata (key, value) VALUES (?, ?)', (k, str(v)))

    conn.commit()
    conn.close()
    print(f'[完成] SQLite 已写入: {db_path}')


if __name__ == '__main__':
    main()
