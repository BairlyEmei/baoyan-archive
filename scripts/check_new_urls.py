#!/usr/bin/env python3
"""
Check new URLs in a PR diff against an allowlist.

Usage:
    git diff origin/main...HEAD -- 'src/content/docs/统计专业档案/**.md' \
        | python scripts/check_new_urls.py

Reads the unified diff from stdin and checks every URL that appears in
added lines (+...) against config/link-allowlist.txt.

Exit codes:
    0  all URLs are allowed (or nothing to check)
    1  one or more URLs are not allowed
"""

import fnmatch
import ipaddress
import re
import sys
from urllib.parse import urlparse

# ── 1. Collect added lines from stdin ──────────────────────────────────────
added_lines = [
    line for line in sys.stdin
    if line.startswith("+") and not line.startswith("++")
]

if not added_lines:
    print("ℹ️ 没有新增内容行，跳过 URL 检查。")
    sys.exit(0)

# ── 2. Load allowlist ───────────────────────────────────────────────────────
try:
    with open("config/link-allowlist.txt", encoding="utf-8") as f:
        allowlist = [
            line.strip()
            for line in f
            if line.strip() and not line.startswith("#")
        ]
except FileNotFoundError:
    print("⚠️ 未找到 config/link-allowlist.txt，跳过检查。")
    sys.exit(0)

if not allowlist:
    print("⚠️ 白名单为空，跳过 URL 检查。")
    sys.exit(0)

# ── 3. Extract and validate URLs ────────────────────────────────────────────
# Matches http/https URLs; stops at whitespace, angle brackets, quotes, or a
# closing parenthesis (the opening paren is kept so Wikipedia disambiguation
# links like /wiki/Foo_(bar) are captured correctly).
URL_RE = re.compile(r'https?://[^\s<>"\')]+')

BLOCKED_SHORTENERS = {"t.co", "bit.ly", "suo.im", "is.gd", "tinyurl.com"}

bad_urls = []

for line in added_lines:
    for url in URL_RE.findall(line):
        domain = urlparse(url).netloc.split(":")[0]
        if not domain:
            continue

        # Block bare IPs
        try:
            ipaddress.ip_address(domain)
            bad_urls.append((url, "禁止使用裸 IP"))
            continue
        except ValueError:
            pass

        # Block URL shorteners
        if domain in BLOCKED_SHORTENERS:
            bad_urls.append((url, "禁止使用短网址服务"))
            continue

        # Allowlist check (exact match or glob pattern)
        allowed = any(
            domain == pattern or fnmatch.fnmatch(domain, pattern)
            for pattern in allowlist
        )
        if not allowed:
            bad_urls.append((url, f"域名 {domain} 不在白名单中"))

# ── 4. Report results ───────────────────────────────────────────────────────
if bad_urls:
    print("❌ 发现违规链接！PR 包含不在白名单或被禁止的域名：\n")
    for url, reason in bad_urls:
        print(f"  - {url}  ({reason})")
    print()
    print("💡 修复建议：")
    print(
        "请确保链接是官方来源。如果该域名是合法的学校/机构官网，"
        "请在本次 PR 中修改 `config/link-allowlist.txt` 申请加白。"
    )
    sys.exit(1)

print("✅ 新增链接域名安全检查通过！")
