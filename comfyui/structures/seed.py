"""Seeds shared by the Qwen-Image-2.1 and MiniMax H3 workflows."""
import random
import re

# Browsers parse JSON numbers as doubles, so a seed is only shown and reused exactly up to 2**53 - 1.
MAX_SEED = 2**53 - 1
# Random seeds stay short enough to read and retype.
RANDOM_SEED_LIMIT = 2**32
QWEN_SEED_OPTION = "qwen_fixed_seed"
H3_SEED_OPTION = "h3_fixed_seed"


def fixed_seed(options: dict | None, key: str, count: int = 1) -> int | None:
    """Return the fixed base seed in workflow options, or None when the seed is random (empty or unset)."""
    value = (options or {}).get(key)
    if value is None or value == "":
        return None
    if isinstance(value, bool) or not (
        isinstance(value, int) or (isinstance(value, str) and re.fullmatch(r"[0-9]+", value.strip()))
    ):
        raise ValueError("种子必须是非负整数")
    seed = int(value)
    # Image n of a batch uses seed + n, which must stay in range as well.
    upper = MAX_SEED - (max(count, 1) - 1)
    if not 0 <= seed <= upper:
        raise ValueError(f"种子必须在 0 到 {upper} 之间")
    return seed


def round_seeds(options: dict | None, key: str, count: int = 1) -> list[int]:
    """Seed of each result in a round: a fixed seed counts up from itself, random mode draws a distinct seed per result."""
    seed = fixed_seed(options, key, count)
    if seed is None:
        return random.sample(range(RANDOM_SEED_LIMIT), count)
    return [seed + index for index in range(count)]
