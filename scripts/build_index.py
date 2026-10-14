#!/usr/bin/env python3
"""Builds index.json from items/<steam id>/<item id>/ and checks every submission.

    python scripts/build_index.py           # write index.json
    python scripts/build_index.py --check   # only validate (used on pull requests)

Each item folder holds design.vsd, thumb.png and meta.json, written by the relay.
Anything malformed is reported and left out of the index rather than breaking it.
"""
import json
import os
import re
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ITEMS = os.path.join(ROOT, "items")
AUTHORS = os.path.join(ROOT, "authors")

KINDS = {"Wearable", "Item", "NPC", "Projectile"}
SLOTS = {"", "Head", "Body", "Legs", "Front", "Back"}
PNG = b"\x89PNG\r\n\x1a\n"
LIMITS = {"design.vsd": 2 * 1024 * 1024, "thumb.png": 300 * 1024}


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def check_item(author, item, folder, problems):
    where = f"items/{author}/{item}"
    if not re.fullmatch(r"\d{1,20}", author):
        problems.append(f"{where}: author folder must be a Steam id")
        return None
    if not re.fullmatch(r"[0-9a-f]{32}", item):
        problems.append(f"{where}: item folder must be a 32-character hex id")
        return None
    for name, limit in LIMITS.items():
        p = os.path.join(folder, name)
        if not os.path.isfile(p):
            problems.append(f"{where}: missing {name}")
            return None
        if os.path.getsize(p) > limit:
            problems.append(f"{where}: {name} is larger than {limit // 1024} KB")
            return None
    with open(os.path.join(folder, "design.vsd"), "rb") as f:
        if f.read(4) != b"VSD1":
            problems.append(f"{where}: design.vsd is not a Vanity Studio file")
            return None
    with open(os.path.join(folder, "thumb.png"), "rb") as f:
        if f.read(8) != PNG:
            problems.append(f"{where}: thumb.png is not a PNG")
            return None
    try:
        meta = read_json(os.path.join(folder, "meta.json"))
    except (OSError, ValueError) as e:
        problems.append(f"{where}: meta.json unreadable ({e})")
        return None

    def text(key, limit):
        v = meta.get(key, "")
        return v[:limit] if isinstance(v, str) else ""

    entry = {
        "id": item,
        "name": text("name", 40) or "Untitled",
        "description": text("description", 200),
        "kind": text("kind", 16),
        "slot": text("slot", 8),
        "target": text("target", 120),
        "basedOn": text("basedOn", 80),
        "authorId": author,
        "authorName": text("authorName", 40) or "Player",
        "path": where,
        "created": text("created", 40),
        "frames": int(meta.get("frames", 1)) if str(meta.get("frames", 1)).isdigit() else 1,
        "width": int(meta.get("width", 0)) if str(meta.get("width", 0)).isdigit() else 0,
        "height": int(meta.get("height", 0)) if str(meta.get("height", 0)).isdigit() else 0,
    }
    if entry["kind"] not in KINDS:
        problems.append(f"{where}: unknown kind '{entry['kind']}'")
        return None
    if entry["slot"] not in SLOTS:
        problems.append(f"{where}: unknown slot '{entry['slot']}'")
        return None
    author_file = os.path.join(AUTHORS, author, "author.json")
    if os.path.isfile(author_file):
        try:
            name = read_json(author_file).get("name")
            if isinstance(name, str) and name.strip():
                entry["authorName"] = name.strip()[:40]
        except (OSError, ValueError):
            pass
    return entry


def main():
    check_only = "--check" in sys.argv
    problems, items = [], []
    if os.path.isdir(ITEMS):
        for author in sorted(os.listdir(ITEMS)):
            adir = os.path.join(ITEMS, author)
            if not os.path.isdir(adir):
                continue
            for item in sorted(os.listdir(adir)):
                folder = os.path.join(adir, item)
                if os.path.isdir(folder):
                    e = check_item(author, item, folder, problems)
                    if e:
                        items.append(e)
    items.sort(key=lambda e: e["created"], reverse=True)

    for p in problems:
        print("problem:", p)
    if check_only:
        print(f"{len(items)} valid item(s), {len(problems)} problem(s)")
        sys.exit(1 if problems else 0)

    index = {
        "version": 1,
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "count": len(items),
        "items": items,
    }
    with open(os.path.join(ROOT, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"index.json: {len(items)} item(s)")


if __name__ == "__main__":
    main()
