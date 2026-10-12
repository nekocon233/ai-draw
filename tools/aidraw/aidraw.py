#!/usr/bin/env python3
"""Entry point of the `aidraw` command; see aidraw_cli/cli.py."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from aidraw_cli.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
