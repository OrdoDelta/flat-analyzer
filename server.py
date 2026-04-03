#!/usr/bin/env python3

import json
import mimetypes
import os
import pathlib
import shutil
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


HOST = "127.0.0.1"
PORT = 8000
ROOT = pathlib.Path(__file__).resolve().parent
ALLOWED_HOSTS = {"immobilienscout24.de", "www.immobilienscout24.de"}
PLAYWRIGHT_SCRIPT = ROOT / "playwright_fetch.js"


def normalize_cookie(raw_cookie):
    cookie = str(raw_cookie or "").strip()
    if not cookie:
        return ""

    if "\n" in cookie:
        for line in cookie.splitlines():
            stripped = line.strip()
            if stripped.lower().startswith("cookie:"):
                return stripped.split(":", 1)[1].strip()
        cookie = " ".join(part.strip() for part in cookie.splitlines() if part.strip())

    if cookie.lower().startswith("cookie:"):
        cookie = cookie.split(":", 1)[1].strip()

    return cookie


def detect_blocked_page(url, status, html):
    lowered = (html or "").lower()

    if status in {401, 403}:
        return {
            "blocked": True,
            "reason": "auth",
            "hint": (
                "ImmoScout24 rejected the request. If the page opens in your browser, "
                "copy your browser Cookie header into the optional ImmoScout-Cookie field and try again."
            ),
        }

    blocked_markers = [
        "anmeldung",
        "einloggen",
        "login",
        "authwall",
        "captcha",
        "access denied",
        "zugriff verweigert",
        "robot",
        "bot",
    ]
    has_marker = any(marker in lowered for marker in blocked_markers)
    looks_like_immoscout = "immobilienscout24" in lowered or "is24" in lowered
    has_listing_shape = "/expose/" in lowered or "purchaseprice" in lowered or "livingSpace" in html or "itemlistelement" in lowered

    if looks_like_immoscout and has_marker and not has_listing_shape:
        return {
            "blocked": True,
            "reason": "login-page",
            "hint": (
                "ImmoScout24 returned a login or protection page instead of listing data. "
                "Paste your browser Cookie header into the optional ImmoScout-Cookie field and retry."
            ),
        }

    return {"blocked": False, "reason": None, "hint": None}


def fetch_via_http(url, cookie):
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Encoding": "identity",
            "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "Referer": "https://www.immobilienscout24.de/",
            "Origin": "https://www.immobilienscout24.de",
            "Upgrade-Insecure-Requests": "1",
        },
    )
    if cookie:
        request.add_header("Cookie", cookie)

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read()
            content_type = response.headers.get("Content-Type", "text/html")
            charset = response.headers.get_content_charset() or "utf-8"
            html = body.decode(charset, errors="replace")
            block_result = detect_blocked_page(response.geturl(), response.status, html)
            return {
                "ok": not block_result["blocked"],
                "status": response.status,
                "finalUrl": response.geturl(),
                "contentType": content_type,
                "html": html,
                "error": "Blocked page returned instead of listing data." if block_result["blocked"] else None,
                "hint": block_result["hint"],
                "blockedReason": block_result["reason"],
                "fetchMode": "http",
            }
    except urllib.error.HTTPError as exc:
        body = exc.read()
        content_type = exc.headers.get("Content-Type", "text/html")
        charset = exc.headers.get_content_charset() or "utf-8"
        html = body.decode(charset, errors="replace")
        block_result = detect_blocked_page(exc.geturl(), exc.code, html)
        return {
            "ok": False,
            "status": exc.code,
            "finalUrl": exc.geturl(),
            "contentType": content_type,
            "html": html,
            "error": f"HTTP {exc.code}",
            "hint": block_result["hint"],
            "blockedReason": block_result["reason"],
            "fetchMode": "http",
        }


def run_playwright_fetch(url):
    node_bin = os.environ.get("NODE_BIN") or shutil.which("node")
    if not node_bin:
        return {
            "ok": False,
            "error": "Playwright fallback unavailable because `node` is not installed.",
            "fetchMode": "playwright",
            "hint": "Install Node.js and run `npm install` in the project folder to enable browser-based URL import.",
        }

    if not PLAYWRIGHT_SCRIPT.exists():
        return {
            "ok": False,
            "error": "Playwright fallback script is missing.",
            "fetchMode": "playwright",
        }

    try:
        completed = subprocess.run(
            [node_bin, str(PLAYWRIGHT_SCRIPT), url],
            cwd=str(ROOT),
            check=False,
            capture_output=True,
            text=True,
            timeout=90,
        )
    except Exception as exc:
        return {
            "ok": False,
            "error": f"Playwright fallback could not be started: {exc}",
            "fetchMode": "playwright",
        }

    stdout = (completed.stdout or "").strip()
    last_line = stdout.splitlines()[-1] if stdout else ""
    try:
        payload = json.loads(last_line) if last_line else {}
    except json.JSONDecodeError:
        payload = {}

    stderr = (completed.stderr or "").strip()
    if stderr and not payload.get("details"):
        payload["details"] = stderr

    if not payload:
        payload = {
            "ok": False,
            "error": "Playwright fallback returned no usable output.",
            "fetchMode": "playwright",
            "details": stderr or stdout,
        }

    payload.setdefault("fetchMode", "playwright")
    return payload


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_POST(self):
        if self.path != "/api/fetch":
            self.send_error(HTTPStatus.NOT_FOUND, "Unknown endpoint")
            return

        length = int(self.headers.get("Content-Length", "0") or 0)
        raw_body = self.rfile.read(length)

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": "Invalid JSON body."},
            )
            return

        url = str(payload.get("url") or "").strip()
        cookie = normalize_cookie(payload.get("cookie") or "")

        if not url:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Missing URL."})
            return

        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in {"http", "https"}:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Only http/https URLs are supported."})
            return

        if parsed.hostname not in ALLOWED_HOSTS:
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": "Only ImmoScout24 URLs are supported in this version."},
            )
            return

        try:
            http_result = fetch_via_http(url, cookie)
        except Exception as exc:
            self._send_json(
                HTTPStatus.BAD_GATEWAY,
                {"ok": False, "error": f"Fetch failed: {exc}"},
            )
            return

        if http_result.get("ok"):
            self._send_json(HTTPStatus.OK, http_result)
            return

        should_try_playwright = http_result.get("status") in {401, 403} or bool(http_result.get("blockedReason"))
        if should_try_playwright:
            playwright_result = run_playwright_fetch(url)
            if playwright_result.get("ok"):
                merged_hint = playwright_result.get("hint") or http_result.get("hint")
                playwright_result["hint"] = merged_hint
                self._send_json(HTTPStatus.OK, playwright_result)
                return

            fallback_hint = playwright_result.get("hint") or http_result.get("hint")
            http_result["hint"] = fallback_hint
            http_result["playwrightError"] = playwright_result.get("error")
            http_result["playwrightDetails"] = playwright_result.get("details")
            http_result["playwrightAvailable"] = False if "not installed" in str(playwright_result.get("error", "")).lower() else True

        self._send_json(HTTPStatus.OK, http_result)

    def guess_type(self, path):
        if str(path).endswith(".js"):
            return "application/javascript"
        return mimetypes.guess_type(path)[0] or "application/octet-stream"

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main():
    server = ThreadingHTTPServer((HOST, PORT), AppHandler)
    print(f"Serving Flat Analyzer at http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
