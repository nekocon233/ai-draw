"""Copy a captioned style dataset into a reproducible AI Toolkit train/holdout split."""
import argparse
import hashlib
import json
from pathlib import Path
import random
import shutil


def prepare(source: Path, destination: Path, holdout: int = 5) -> dict:
    images = sorted(path for path in source.iterdir() if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"})
    if len(images) <= holdout or holdout < 1:
        raise ValueError("Dataset needs more images than the validation split")
    files = []
    for image in images:
        caption = image.with_suffix(".txt")
        if not caption.is_file() or not caption.read_text(encoding="utf-8").strip():
            raise ValueError(f"Missing caption for {image.name}")
        files.extend((image, caption))
    held_out = set(random.Random(20260921).sample([path.name for path in images], holdout))
    manifest = {
        "source": str(source.resolve()), "seed": 20260921,
        "train": [path.name for path in images if path.name not in held_out],
        "validation": [path.name for path in images if path.name in held_out],
        "sha256": {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in files},
    }
    manifest_path = destination / "manifest.json"
    if destination.exists():
        if not manifest_path.is_file() or json.loads(manifest_path.read_text()) != manifest:
            raise ValueError("Destination already exists with a different dataset; choose a new destination")
        for split in ("train", "validation"):
            for name in manifest[split]:
                for filename in (name, str(Path(name).with_suffix(".txt"))):
                    path = destination / split / filename
                    if hashlib.sha256(path.read_bytes()).hexdigest() != manifest["sha256"][filename]:
                        raise ValueError(f"Existing copy changed: {filename}")
        return manifest
    for split in ("train", "validation"):
        target = destination / split
        target.mkdir(parents=True)
        for name in manifest[split]:
            for path in (source / name, (source / name).with_suffix(".txt")):
                shutil.copy2(path, target / path.name)
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--holdout", type=int, default=5)
    args = parser.parse_args()
    manifest = prepare(args.source, args.destination, args.holdout)
    print(f"Prepared {len(manifest['train'])} training / {len(manifest['validation'])} validation images; originals unchanged.")
