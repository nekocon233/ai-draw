"""Configuration, credentials and small state, kept under ~/.config/aidraw (or $AIDRAW_CONFIG_DIR)."""
import json
import os
import tempfile
from pathlib import Path
from typing import Optional

DEFAULTS = {
    "api_url": "http://127.0.0.1:14600",
    "public_url": "https://aidraw.nekocon.cn",
    "container": "ai-draw-backend",
    # Pause before a new agent task when the previous one just ended, so the user's own clicks get the slot.
    "yield_seconds": 20,
    "poll_seconds": 4,
    "slot_poll_seconds": 5,
    "gate_poll_seconds": 3,
}


def config_dir() -> Path:
    if os.environ.get("AIDRAW_CONFIG_DIR"):
        return Path(os.environ["AIDRAW_CONFIG_DIR"])
    base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(base) / "aidraw"


def cache_dir() -> Path:
    base = os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(base) / "aidraw"


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        return {}


def _write_private(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    handle, temporary = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as file:
            json.dump(data, file, ensure_ascii=False, indent=2)
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


def load_config() -> dict:
    config = {**DEFAULTS, **_read_json(config_dir() / "config.json")}
    for key, variable in (("api_url", "AIDRAW_API_URL"), ("public_url", "AIDRAW_PUBLIC_URL")):
        if os.environ.get(variable):
            config[key] = os.environ[variable]
    config["api_url"] = config["api_url"].rstrip("/")
    config["public_url"] = config["public_url"].rstrip("/")
    return config


def load_credentials() -> dict:
    return _read_json(config_dir() / "credentials.json")


def load_token() -> Optional[str]:
    return os.environ.get("AIDRAW_TOKEN") or load_credentials().get("token")


def save_credentials(data: dict) -> None:
    _write_private(config_dir() / "credentials.json", data)


def clear_credentials() -> None:
    (config_dir() / "credentials.json").unlink(missing_ok=True)


def load_cache(name: str) -> dict:
    return _read_json(cache_dir() / name)


def save_cache(name: str, data: dict) -> None:
    _write_private(cache_dir() / name, data)


def load_state() -> dict:
    return _read_json(config_dir() / "state.json")


def save_state(state: dict) -> None:
    _write_private(config_dir() / "state.json", state)


def session_link(config: dict, session_id: str) -> str:
    return f"{config['public_url']}/?session={session_id}"
