"""Download the ComfyUI Ref2VA checkpoint and verify it before installation."""
import argparse
import hashlib
import time
import shutil
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.request import Request, urlopen

NAME = "minimax_h3_ref2va_pruned_int8_convrot.safetensors"
URL = f"https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/{NAME}"
SIZE = 20970379616
SHA256 = "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779"


def digest(path):
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            checksum.update(chunk)
    return checksum.hexdigest()


def install(directory, workers=8):
    if not directory.is_dir():
        raise ValueError("The existing ComfyUI diffusion_models directory is required")
    target = directory / NAME
    if target.exists():
        if target.stat().st_size == SIZE and digest(target) == SHA256:
            print("Ref2VA checkpoint is already installed and verified", flush=True)
            return
        raise ValueError("Existing checkpoint does not match; refusing to overwrite it")
    partial = target.with_suffix(target.suffix + ".part")
    offset = partial.stat().st_size if partial.exists() else 0
    if offset < SIZE:
        parts_dir = directory / (NAME + ".parts")
        parts_dir.mkdir(exist_ok=True)
        chunk_size = 256 * 1024 * 1024
        ranges = [(start, min(start + chunk_size, SIZE)) for start in range(offset, SIZE, chunk_size)]

        def fetch(bounds):
            start, end = bounds
            piece = parts_dir / f"{start}-{end}"
            if piece.exists() and piece.stat().st_size == end - start:
                return piece
            pending = piece.with_suffix(".part")
            for attempt in range(4):
                try:
                    resume = pending.stat().st_size if pending.exists() else 0
                    if resume < end - start:
                        request = Request(URL, headers={"Range": f"bytes={start + resume}-{end - 1}"})
                        with urlopen(request, timeout=90) as response:
                            expected = f"bytes {start + resume}-{end - 1}/{SIZE}"
                            if response.status != 206 or response.headers.get("Content-Range") != expected:
                                raise ValueError("Download server did not honor the requested byte range")
                            with pending.open("ab") as output:
                                shutil.copyfileobj(response, output, 1024 * 1024)
                    if pending.stat().st_size != end - start:
                        raise ValueError("Incomplete model segment")
                    pending.replace(piece)
                    return piece
                except Exception:
                    if attempt == 3:
                        raise
                    time.sleep(3)

        received = offset
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(fetch, bounds) for bounds in ranges]
            for future in as_completed(futures):
                received += future.result().stat().st_size
                print(f"Downloaded {received / SIZE:.1%} ({received / 1e9:.2f} GB)", flush=True)
        with partial.open("ab") as output:
            for start, end in ranges:
                with (parts_dir / f"{start}-{end}").open("rb") as source:
                    shutil.copyfileobj(source, output, 8 * 1024 * 1024)
    print("Verifying Ref2VA SHA-256...", flush=True)
    if partial.stat().st_size != SIZE or digest(partial) != SHA256:
        raise ValueError("Checkpoint integrity check failed; the partial file was not installed")
    partial.replace(target)
    parts_dir = directory / (NAME + ".parts")
    if parts_dir.exists():
        shutil.rmtree(parts_dir)
    print(f"Installed and verified {target}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("diffusion_models", type=Path)
    parser.add_argument("--workers", type=int, choices=range(1, 17), default=8)
    args = parser.parse_args()
    install(args.diffusion_models, args.workers)
