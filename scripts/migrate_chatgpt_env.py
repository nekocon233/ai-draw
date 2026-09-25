"""Remove retired provider settings without printing credentials or their values."""
import argparse
import os
from pathlib import Path
import re
import stat
import tempfile


RETIRED_KEYS = {
    "AI_PROMPT_API_KEY", "AI_PROMPT_BASE_URL", "AI_PROMPT_MODEL",
    "AI_PROMPT_REUSE_SESSION_TITLE",
}
ACTIVE_VALUES = {"AI_PROMPT_PROVIDER": "codex", "CODEX_LLM_MODEL": "gpt-6-astra"}
ASSIGNMENT = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z_0-9]*)\s*=")


def migrate(content):
    lines, removed, seen = [], set(), set()
    for line in content.splitlines(keepends=True):
        match = ASSIGNMENT.match(line)
        if match:
            key = match[1]
            if key in RETIRED_KEYS or key.startswith(("SESSION_TITLE_", "NANO_BANANA_", "KLING_")):
                removed.add(key)
                continue
            if key in ACTIVE_VALUES:
                if key not in seen:
                    lines.append(f"{key}={ACTIVE_VALUES[key]}\n")
                    seen.add(key)
                continue
            if "bigmodel.cn" in line.lower():
                raise ValueError(f"Unexpected retired provider in {key}; inspect privately")
        elif line.lstrip().startswith("#") and any(
            text in line.lower() for text in ("bigmodel", "nano banana", "nano_banana", "kling", "session title generation", "openai keeps the legacy")
        ):
            continue
        lines.append(line)
    result = "".join(lines)
    for key, value in ACTIVE_VALUES.items():
        if key not in seen:
            if result and not result.endswith("\n"):
                result += "\n"
            result += f"{key}={value}\n"
    return result, sorted(removed)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--path", type=Path, default=Path(".env"))
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    path = args.path.resolve(strict=True)
    original = path.read_text(encoding="utf-8")
    result, removed = migrate(original)
    print("Removed setting names:", ", ".join(removed) or "none")
    print("LLM model:", ACTIVE_VALUES["CODEX_LLM_MODEL"])
    if args.apply and result != original:
        mode = stat.S_IMODE(path.stat().st_mode)
        fd, temporary = tempfile.mkstemp(prefix=".env-migration-", dir=path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as output:
                output.write(result)
                output.flush()
                os.fsync(output.fileno())
            os.chmod(temporary, mode)
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        print("Applied")
    else:
        print("Unchanged" if result == original else "Dry run; use --apply")


if __name__ == "__main__":
    main()
