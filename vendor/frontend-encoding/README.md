# Frontend encoding runtime

Minimal offline DBCS runtime from iconv-lite 0.6.3, MIT licensed. Only the DBCS codec and Chinese mapping tables are shipped. `dbcs-codec.js` changes the `safer-buffer` import to Node's built-in Buffer, supported by the repository's Node baseline. No npm installation is needed at deployment.

Sources are the tag's `encodings/dbcs-codec.js`, `encodings/tables/cp936.json`, `gbk-added.json`, `gb18030-ranges.json`, and `LICENSE`. [Upstream](https://github.com/ashtuchkin/iconv-lite/tree/v0.6.3)

`gb2312.json` contains all 7445 defined two-byte mappings enumerated with CPython 3.13.12's strict `gb2312` codec. Its separate mapping avoids iconv-lite's GB2312 alias to CP936. Python is needed only to regenerate this data. The Python license is retained in `PYTHON-LICENSE.txt`.

`index.js` is the local adapter. Callers must use the plugin's strict round-trip wrapper, which rejects substitutions, malformed bytes and unrepresentable characters. GB18030 uses the pinned iconv-lite mapping version, without claiming conformance to every revision of the GB18030 standard.
