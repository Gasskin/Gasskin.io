#!/usr/bin/env python3
"""
本地联调：托管 docs/，并把 /api/v3/* 反向代理到火山方舟。
页面与接口同源，可避免浏览器对 ark.cn-beijing.volces.com 的跨域限制。

用法：
  python build.py
  python dev_server.py
  浏览器打开 http://127.0.0.1:8765/
"""
from __future__ import annotations

import ssl
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ARK_ORIGIN = "https://ark.cn-beijing.volces.com"
DOCS = Path(__file__).resolve().parent / "docs"
HOST = "127.0.0.1"
PORT = 8765


class DevHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DOCS), **kwargs)

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path.startswith("/api/v3"):
            self._proxy()
            return
        if path in ("/", "/index.html"):
            self._serve_index()
            return
        super().do_GET()

    def do_HEAD(self):
        path = self.path.split("?", 1)[0]
        if path.startswith("/api/v3"):
            self._proxy(head=True)
            return
        if path in ("/", "/index.html"):
            self._serve_index(head=True)
            return
        super().do_HEAD()

    def do_POST(self):
        if self.path.split("?", 1)[0].startswith("/api/v3"):
            self._proxy()
            return
        self.send_error(404, "Not Found")

    def do_DELETE(self):
        if self.path.split("?", 1)[0].startswith("/api/v3"):
            self._proxy()
            return
        self.send_error(404, "Not Found")

    def _serve_index(self, head=False):
        index = DOCS / "index.html"
        raw = index.read_text(encoding="utf-8")
        inject = (
            "<script>window.__SEEDANCE_API_BASE__=location.origin+\"/api/v3\";</script>\n"
        )
        if "</head>" in raw:
            raw = raw.replace("</head>", inject + "</head>", 1)
        else:
            raw = inject + raw
        body = raw.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def _proxy(self, head=False):
        url = f"{ARK_ORIGIN}{self.path}"
        data = None
        if self.command == "POST" and not head:
            length = int(self.headers.get("Content-Length", 0))
            data = self.rfile.read(length) if length else b""

        method = "HEAD" if head else self.command
        req = urllib.request.Request(url, data=data, method=method)
        for name in ("Authorization", "Content-Type"):
            val = self.headers.get(name)
            if val:
                req.add_header(name, val)

        ctx = ssl.create_default_context()
        try:
            resp = urllib.request.urlopen(req, timeout=600, context=ctx)
        except urllib.error.HTTPError as e:
            body = e.read()
            self._write_upstream(e.code, e.headers, body)
            return
        except urllib.error.URLError as e:
            self.send_error(502, str(e.reason if hasattr(e, "reason") else e))
            return

        try:
            body = b"" if head else resp.read()
            self._write_upstream(resp.status, resp.headers, body)
        finally:
            resp.close()

    def _write_upstream(self, status, headers, body):
        body = body or b""
        self.send_response(status)
        ct = "application/octet-stream"
        if headers:
            ct = headers.get("Content-Type", ct)
        self.send_header("Content-Type", ct)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)


def main() -> None:
    if not DOCS.is_dir() or not (DOCS / "index.html").is_file():
        raise SystemExit("请先执行: python build.py")
    httpd = ThreadingHTTPServer((HOST, PORT), DevHandler)
    httpd.allow_reuse_address = True
    print(f"Serving {DOCS} at http://{HOST}:{PORT}/")
    print("API 代理: /api/v3 ->", ARK_ORIGIN + "/api/v3")
    print("按 Ctrl+C 结束")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
