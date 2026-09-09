#!/usr/bin/env python3
"""
本地开发服务器：托管 docs/ 目录，并反向代理需要同源访问的外部 API。
页面与接口同源，可避免浏览器跨域限制。

用法：
  python build.py
  python dev_server.py
  浏览器打开 http://127.0.0.1:8765/
"""
from __future__ import annotations

import ssl
import json
import os
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ARK_ORIGIN = "https://ark.cn-beijing.volces.com"
ROOT = Path(__file__).resolve().parent
DOCS = ROOT / "docs"
HOST = "127.0.0.1"
PORT = 8765
CANVAS_CONFIG_PATH = "/api/canvas-config/kie-image2.json"
KIE_CONFIG_FILE = ROOT / "canvas" / "kie-image2.json"


def validate_kie_config(config):
    # Only non-secret settings are accepted; never serialize the caller's arbitrary object.
    fields = {"version", "baseUrl", "uploadBaseUrl", "modelGroups", "defaultModelGroupId", "defaults"}
    if not isinstance(config, dict) or set(config) != fields or config["version"] != 1:
        raise ValueError("Invalid configuration fields")
    for name in ("baseUrl", "uploadBaseUrl"):
        value = config[name]
        if not isinstance(value, str):
            raise ValueError("Invalid URL")
        url = urllib.parse.urlsplit(value)
        if url.scheme not in ("http", "https") or not url.netloc or url.username or url.password or url.query or url.fragment:
            raise ValueError("Invalid URL")
    groups = config["modelGroups"]
    if not isinstance(groups, list) or not groups:
        raise ValueError("Missing model groups")
    ids = set()
    for group in groups:
        if not isinstance(group, dict) or set(group) != {"id", "name", "textModel", "imageModel"}:
            raise ValueError("Invalid model group fields")
        if any(not isinstance(v, str) or not v.strip() for v in group.values()) or group["id"] in ids:
            raise ValueError("Invalid model group")
        ids.add(group["id"])
    if config["defaultModelGroupId"] not in ids:
        raise ValueError("Invalid default group")
    defaults = config["defaults"]
    if not isinstance(defaults, dict) or set(defaults) != {"resolution", "aspectRatio"}:
        raise ValueError("Invalid defaults")
    ratio, resolution = defaults["aspectRatio"], defaults["resolution"]
    if resolution not in ("1K", "2K", "4K") or ratio not in (
        "auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5",
        "16:9", "9:16", "2:1", "1:2", "3:1", "1:3", "21:9", "9:21",
    ):
        raise ValueError("Invalid defaults")
    if (ratio == "1:1" and resolution == "4K") or (resolution != "1K" and ratio in ("auto", "5:4", "4:5", "3:1", "1:3", "9:21")):
        raise ValueError("Unsupported default resolution and ratio")
    return config


def write_json_atomic(target, config):
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=target.parent, delete=False) as output:
        temporary = output.name
        try:
            json.dump(config, output, ensure_ascii=False, indent=2)
            output.write("\n")
        except Exception:
            output.close()
            os.unlink(temporary)
            raise
    try:
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class DevHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DOCS), **kwargs)

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in ("/canvas/kie-image2.json", "/canvas/prompt-guide.json"):
            config_file = KIE_CONFIG_FILE if path.endswith("/kie-image2.json") else ROOT / "canvas" / "prompt-guide.json"
            try:
                body = config_file.read_bytes()
            except OSError:
                self.send_error(404, "Canvas configuration file unavailable")
                return
            self._write_upstream(200, {"Content-Type": "application/json; charset=utf-8"}, body)
            return
        if self._is_proxy_path(path):
            self._proxy()
            return
        # 对所有 index.html 注入 API base（插件页面可能需要）
        if path in ("/", "/index.html") or path.endswith("/index.html") or path.endswith("/"):
            self._serve_html_with_inject(path)
            return
        super().do_GET()

    def do_HEAD(self):
        path = self.path.split("?", 1)[0]
        if self._is_proxy_path(path):
            self._proxy(head=True)
            return
        if path in ("/", "/index.html") or path.endswith("/index.html") or path.endswith("/"):
            self._serve_html_with_inject(path, head=True)
            return
        super().do_HEAD()

    def do_POST(self):
        if self._is_proxy_path(self.path.split("?", 1)[0]):
            self._proxy()
            return
        self.send_error(404, "Not Found")

    def do_DELETE(self):
        if self._is_proxy_path(self.path.split("?", 1)[0]):
            self._proxy()
            return
        self.send_error(404, "Not Found")

    def do_PUT(self):
        if self.path != CANVAS_CONFIG_PATH:
            self.send_error(404, "Not Found")
            return
        port = self.server.server_address[1]
        host = self.headers.get("Host", "")
        if host not in (f"127.0.0.1:{port}", f"localhost:{port}") or self.headers.get("Origin") != f"http://{host}":
            self.send_error(403, "Only same-origin local requests may save configuration")
            return
        if self.headers.get_content_type() != "application/json":
            self.send_error(415, "Expected application/json")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 65536:
                raise ValueError("Invalid content length")
            config = validate_kie_config(json.loads(self.rfile.read(length)))
        except (ValueError, TypeError, KeyError):
            self.send_error(400, "Invalid non-secret KIE configuration")
            return
        try:
            write_json_atomic(KIE_CONFIG_FILE, config)
            write_json_atomic(DOCS / "canvas" / "kie-image2.json", config)
        except OSError:
            self.send_error(500, "Could not save configuration file")
            return
        self._write_upstream(200, {"Content-Type": "application/json"}, b'{"ok":true}')

    @staticmethod
    def _is_proxy_path(path):
        return path.startswith("/api/v3")

    def _serve_html(self, filepath, head=False, inject_api=False):
        raw = filepath.read_text(encoding="utf-8")
        if inject_api:
            snippet = (
                "<script>"
                "window.__SEEDANCE_API_BASE__=location.origin+\"/api/v3\";"
                "window.__CANVAS_CONFIG_SAVE_URL__=\"/api/canvas-config/kie-image2.json\";"
                "</script>\n"
            )
            if "</head>" in raw:
                raw = raw.replace("</head>", snippet + "</head>", 1)
            else:
                raw = snippet + raw
        body = raw.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def _serve_html_with_inject(self, path, head=False):
        """为 index.html 注入 API base 脚本（供需要代理的插件使用）。"""
        if path.endswith("/"):
            path += "index.html"
        filepath = DOCS / path.lstrip("/")
        if not filepath.is_file():
            self.send_error(404, "Not Found")
            return
        # 非根页面才注入 API base
        inject_api = path != "/index.html"
        self._serve_html(filepath, head=head, inject_api=inject_api)

    def _proxy(self, head=False):
        path = self.path.split("?", 1)[0]
        url = f"{ARK_ORIGIN}{self.path}"
        data = None
        if self.command == "POST" and not head:
            length = int(self.headers.get("Content-Length", 0))
            data = self.rfile.read(length) if length else b""

        method = "HEAD" if head else self.command
        req = urllib.request.Request(url, data=data, method=method)
        for name in ("Authorization", "Content-Type", "Idempotency-Key", "Accept"):
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
