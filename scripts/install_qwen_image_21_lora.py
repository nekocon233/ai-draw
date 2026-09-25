"""Validate an AI Toolkit Qwen-Image-2.1 LoRA before installing it for ComfyUI."""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import tempfile

from safetensors import safe_open
import torch


def validate(path: Path) -> tuple[int, int]:
    with safe_open(path, framework="pt", device="cpu") as weights:
        if (weights.metadata() or {}).get("ss_base_model_version") != "qwen_image_2":
            raise ValueError("Expected an AI Toolkit Qwen-Image-2.1 adapter (qwen_image_2)")
        keys = list(weights.keys())
        if not keys or any(not key.startswith("diffusion_model.") for key in keys):
            raise ValueError("Expected ComfyUI diffusion_model LoRA keys")
        trained = 0
        for key in keys:
            if not (key.endswith((".lora_A.weight", ".lora_B.weight", ".alpha"))):
                raise ValueError(f"Unexpected adapter tensor: {key}")
            tensor = weights.get_tensor(key)
            if not torch.isfinite(tensor).all():
                raise ValueError("Adapter contains non-finite weights")
            if key.endswith(".lora_B.weight") and tensor.abs().max() > 0:
                trained += 1
        if not trained:
            raise ValueError("Adapter has no trained up-projections")
        return len(keys), trained


def install(source: Path, destination: Path) -> str:
    if source.resolve() == destination.resolve() or destination.suffix != ".safetensors":
        raise ValueError("Choose a different .safetensors destination")
    if not destination.parent.is_dir():
        raise ValueError("The destination LoRA directory must already exist")
    validate(source)
    descriptor, temporary = tempfile.mkstemp(prefix=".qwen21-", dir=destination.parent)
    try:
        with os.fdopen(descriptor, "wb") as output, source.open("rb") as original:
            shutil.copyfileobj(original, output)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, 0o644)
        digest = hashlib.sha256(Path(temporary).read_bytes()).hexdigest()
        os.replace(temporary, destination)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return digest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path, nargs="?")
    args = parser.parse_args()
    count, trained = validate(args.source)
    print(f"Validated {count} tensors; {trained} trained up-projections.")
    if args.destination:
        print(f"Installed {args.destination.name}; sha256={install(args.source, args.destination)}")
