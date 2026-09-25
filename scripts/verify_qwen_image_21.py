"""Run the production Qwen adapter against ComfyUI and save a validation PNG."""
import argparse
import asyncio
import base64
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from comfyui.comfyui_service import ComfyUIService
from comfyui.requests.local_comfyui_request import LocalComfyUIRequest
from server.generation.contracts import GenerationParameters, ProviderInput
from server.generation.qwen_image_21 import QwenImage21Provider, validate_qwen_image_21
from PIL import Image


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, action="append", default=[])
    parser.add_argument("--prompt", default="一只橘猫坐在窗边，旁边有一个蓝色杯子，清晰的二维插画")
    parser.add_argument("--lora", default="")
    parser.add_argument("--width", type=int, default=512)
    parser.add_argument("--height", type=int, default=512)
    parser.add_argument("--steps", default="20")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--reference-resolution", default="512")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if len(args.image) > 3:
        parser.error("the app accepts at most three references")
    workflow = "qwen_image_21_i2i" if args.image else "qwen_image_21_t2i"
    encoded = [base64.b64encode(path.read_bytes()).decode("ascii") for path in args.image]
    references = (encoded + [None] * 3)[:3]
    params = GenerationParameters(
        args.prompt, workflow=workflow, lora_prompt=args.lora,
        width=args.width, height=args.height, use_original_size=bool(encoded),
        reference_image=references[0], reference_image_2=references[1], reference_image_3=references[2],
        workflow_options={"qwen_steps": args.steps, "qwen_reference_resolution": args.reference_resolution},
    )
    validate_qwen_image_21(params)
    service = ComfyUIService(LocalComfyUIRequest())
    service.switch_workflow(workflow)
    result = await QwenImage21Provider(service, seed=args.seed).generate(ProviderInput(params, tuple(references)))
    args.output.write_bytes(base64.b64decode(result.content))
    with Image.open(args.output) as image:
        image.load()
        print(f"Validated {workflow}: {image.width}x{image.height} {image.mode}; {args.output.name}")


if __name__ == "__main__":
    asyncio.run(main())
