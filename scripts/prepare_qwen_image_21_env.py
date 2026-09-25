"""Add required Qwen model settings without printing or replacing existing secrets."""
import argparse
import os
from pathlib import Path
import re
import tempfile


DEFAULTS = {
    "QWEN_IMAGE_21_MODEL_FILE": "qwen_image_2.1_int8_convrot.safetensors",
    "QWEN_IMAGE_21_TEXT_ENCODER_FILE": "qwen3vl_8b_int8_convrot.safetensors",
    "QWEN_IMAGE_21_VAE_FILE": "qwen_image_2.1_vae_bf16.safetensors",
}


def migrate(path: Path) -> int:
    original = path.read_text(encoding="utf-8")
    missing = {key: value for key, value in DEFAULTS.items()
               if not re.search(rf"^\s*(?:export\s+)?{key}\s*=", original, re.MULTILINE)}
    if not missing:
        return 0
    content = original.rstrip("\r\n") + "\n\n# Qwen-Image-2.1\n"
    content += "".join(f"{key}={value}\n" for key, value in missing.items())
    descriptor, temporary = tempfile.mkstemp(prefix=".qwen21_env_", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, path.stat().st_mode & 0o777)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return len(missing)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", type=Path, default=Path(".env"))
    args = parser.parse_args()
    print(f"Added {migrate(args.path)} Qwen settings; existing values preserved.")
