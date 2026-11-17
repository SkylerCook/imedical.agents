"use strict";
// Isolated source-test fixture server; no business paths or browser runner.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const repo = path.resolve(__dirname, "../../..");
const vendor = path.join(repo, "vendor/hisui/dist");
const types = { ".js": "application/javascript", ".css": "text/css", ".html": "text/html; charset=utf-8",
    ".png": "image/png", ".gif": "image/gif", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff" };
const server = http.createServer((req, res) => {
    let file;
    try {
        const url = new URL(req.url, "http://127.0.0.1");

        if (url.pathname === "/review-frame") {
            const theme = url.searchParams.get("theme") || "pure";
            if (!["pure", "vben", "lite"].includes(theme)) throw new Error("unknown fixture theme");
            const bodyTheme = theme === "vben" ? "bgseablue" : "";
            const child = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Anonymous child frame</title>' +
                '<script>window.HISUIStyleCode="' + theme + '";window.HISUITheme="' + bodyTheme + '";</script>' +
                '<link rel="stylesheet" href="/hisui/css/hisui.' + theme + '.css">' +
                '<style>body{margin:0;padding:0;font-size:14px}#frameOrigin{height:20px}</style>' +
                '<script src="/hisui/js/jquery-1.11.3.min.js"></script><script src="/hisui/js/jquery.hisui.js"></script></head>' +
                '<body hisui-version="' + theme + '" data-theme="' + bodyTheme + '"><div id="frameOrigin">Child origin</div><table id="frameGrid"></table>' +
                '<script>$(function(){$("#frameGrid").datagrid({width:Math.max(100,document.body.clientWidth),height:110,border:false,toolbar:null,' +
                'columns:[[{field:"label",title:"Item",width:140}]],data:[{label:"Anonymous item"}]});document.body.setAttribute("data-frame-state","ready");});</script></body></html>';
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
            res.end(child);
            return;
        }

        if (url.pathname === "/") file = path.join(__dirname, "iris-ui.html");
        else if (url.pathname === "/collect-ui-metrics.js") file = path.join(repo, "plugins/iris-ui/scripts/collect-ui-metrics.js");
        else if (url.pathname.startsWith("/hisui/")) {
            file = path.resolve(vendor, decodeURIComponent(url.pathname.slice(7)));
            if (!file.startsWith(vendor + path.sep)) throw new Error("outside fixture resources");
        }
        if (!file || !fs.statSync(file).isFile()) throw new Error("not found");
        let content = fs.readFileSync(file);
        if (file === path.join(__dirname, "iris-ui.html")) {
            const theme = url.searchParams.get("theme") || "pure";
            if (!["pure", "vben", "lite"].includes(theme)) throw new Error("unknown fixture theme");
            content = content.toString("utf8").replace("/hisui/css/hisui.pure.css", "/hisui/css/hisui." + theme + ".css");
        }
        res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
        res.end(content);
    } catch {
        res.writeHead(404); res.end("Fixture resource not found");
    }
});
server.listen(0, "127.0.0.1", () => process.stdout.write(JSON.stringify({ url: "http://127.0.0.1:" + server.address().port }) + "\n"));
process.stdin.setEncoding("utf8");
process.stdin.on("data", data => { if (data.trim() === "stop") server.close(() => process.exit(0)); });
