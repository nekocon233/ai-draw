"""Build the Qwen-Image-2.1 graphs: the official pipeline plus a LoRA loader.

The official templates wrap the pipeline in a subgraph, which hides the model link the
adapter has to patch. The editor workflows are the unpacked form the official notes
describe, with `LoraLoaderModelOnly` between the diffusion model and the sampler, so a
style LoRA can be selected, re-weighted or bypassed (Ctrl+B) without entering a subgraph.

The same node set drives the app templates in `configs/workflows/`, so both stay in sync.
The API form drops three editor conveniences the backend already decides per request:
the resolution selector (the request carries width and height), the custom-size switch
(the adapter wires the sampler latent itself) and the example `LoadImage` nodes
(references are uploaded and inserted per request).
"""
import argparse
import json
from pathlib import Path

UNET = "qwen_image_2.1_int8_convrot.safetensors"
CLIP = "qwen3vl_8b_int8_convrot.safetensors"
VAE = "qwen_image_2.1_vae_bf16.safetensors"
LORA = "Ameniwa.safetensors"
LORA_STRENGTH = 0.8
STEPS = 40  # Official template ships 25; the official pipeline and this app use 40.
SEED = 42

MODELS = {
    "UNETLoader": [{"name": UNET, "directory": "diffusion_models",
                    "url": f"https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/diffusion_models/{UNET}"}],
    "CLIPLoader": [{"name": CLIP, "directory": "text_encoders",
                    "url": f"https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/text_encoders/{CLIP}"}],
    "VAELoader": [{"name": VAE, "directory": "vae",
                   "url": f"https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/vae/{VAE}"}],
}

# Socket layout per node type: (name, type, kind). kind: "in", "widget", "optional".
SOCKETS = {
    "UNETLoader": [("unet_name", "COMBO", "widget"), ("weight_dtype", "COMBO", "widget")],
    "LoraLoaderModelOnly": [("model", "MODEL", "in"), ("lora_name", "COMBO", "widget"),
                            ("strength_model", "FLOAT", "widget")],
    "CLIPLoader": [("clip_name", "COMBO", "widget"), ("type", "COMBO", "widget"),
                   ("device", "COMBO", "widget")],
    "VAELoader": [("vae_name", "COMBO", "widget")],
    "QwenImage21Cache": [("model", "MODEL", "in"), ("device", "COMBO", "widget"),
                         ("dtype", "COMBO", "widget")],
    "EmptyLatentImage": [("width", "INT", "widget"), ("height", "INT", "widget"),
                         ("batch_size", "INT", "widget")],
    "ResolutionSelector": [],
    "LoadImage": [("image", "COMBO", "widget")],
    "ComfySwitchNode": [("on_false", "LATENT", "optional"), ("on_true", "LATENT", "optional"),
                        ("switch", "BOOLEAN", "widget")],
    "KSampler": [("model", "MODEL", "in"), ("positive", "CONDITIONING", "in"),
                 ("negative", "CONDITIONING", "in"), ("latent_image", "LATENT", "in"),
                 ("seed", "INT", "widget"), ("steps", "INT", "widget"), ("cfg", "FLOAT", "widget"),
                 ("sampler_name", "COMBO", "widget"), ("scheduler", "COMBO", "widget"),
                 ("denoise", "FLOAT", "widget")],
    "VAEDecode": [("samples", "LATENT", "in"), ("vae", "VAE", "in")],
    "SaveImageAdvanced": [("images", "IMAGE", "in")],
    "MarkdownNote": [],
}
OUTPUTS = {
    "UNETLoader": [("MODEL", "MODEL")],
    "LoraLoaderModelOnly": [("MODEL", "MODEL")],
    "CLIPLoader": [("CLIP", "CLIP")],
    "VAELoader": [("VAE", "VAE")],
    "QwenImage21Cache": [("MODEL", "MODEL")],
    "TextEncodeQwenImage21": [("positive", "CONDITIONING"), ("negative", "CONDITIONING"),
                              ("latent", "LATENT")],
    "EmptyLatentImage": [("LATENT", "LATENT")],
    "ResolutionSelector": [("width", "INT"), ("height", "INT")],
    "LoadImage": [("IMAGE", "IMAGE"), ("MASK", "MASK")],
    "ComfySwitchNode": [("output", "LATENT")],
    "KSampler": [("LATENT", "LATENT")],
    "VAEDecode": [("IMAGE", "IMAGE")],
    "SaveImageAdvanced": [("images", "IMAGE")],
    "MarkdownNote": [],
}


def text_encode_sockets(references: int) -> list[tuple[str, str, str]]:
    """The encoder grows one `images.image_N` socket per reference, as the official edit graph does."""
    sockets = [("clip", "CLIP", "in")]
    sockets += [(f"images.image_{index}", "IMAGE", "optional") for index in range(1, references + 1)]
    sockets += [("vae", "VAE", "optional")] if references else []
    return sockets + [("prompt", "STRING", "widget"), ("negative_prompt", "STRING", "widget"),
                      ("resolution", "INT", "widget")]


class Graph:
    def __init__(self):
        self.nodes: list[dict] = []
        self.links: list[list] = []
        self.groups: list[dict] = []

    def add(self, type_name, pos, size, widgets=(), sockets=None, extra=None):
        node = {
            "id": len(self.nodes) + 1, "type": type_name, "pos": list(pos), "size": list(size),
            "flags": {}, "order": len(self.nodes), "mode": 0,
            "inputs": [], "outputs": [], "properties": {"Node name for S&R": type_name},
            "widgets_values": list(widgets),
        }
        for name, socket_type, kind in (SOCKETS[type_name] if sockets is None else sockets):
            entry = {"name": name, "type": socket_type, "link": None}
            if kind == "widget":
                entry["widget"] = {"name": name}
            if kind == "optional":
                entry["shape"] = 7
            node["inputs"].append(entry)
        node["outputs"] = [{"name": name, "type": socket_type, "links": []}
                           for name, socket_type in OUTPUTS[type_name]]
        if type_name in MODELS:
            node["properties"]["models"] = MODELS[type_name]
        node.update(extra or {})
        self.nodes.append(node)
        return node

    def note(self, pos, text):
        node = self.add("MarkdownNote", pos, (420, 700), [text])
        node["properties"] = {}
        node["color"] = "#432"
        node["bgcolor"] = "#653"
        return node

    def group(self, title, bounding):
        self.groups.append({"id": len(self.groups) + 1, "title": title, "bounding": list(bounding),
                            "color": "#3f789e", "font_size": 24, "flags": {}})

    def connect(self, source, output_name, target, input_name):
        out_index = next(i for i, item in enumerate(source["outputs"]) if item["name"] == output_name)
        in_index = next(i for i, item in enumerate(target["inputs"]) if item["name"] == input_name)
        link_id = len(self.links) + 1
        source["outputs"][out_index]["links"].append(link_id)
        target["inputs"][in_index]["link"] = link_id
        self.links.append([link_id, source["id"], out_index, target["id"], in_index,
                           source["outputs"][out_index]["type"]])

    def serialize(self) -> dict:
        for order, node in enumerate(sorted(self.nodes, key=lambda item: item["id"])):
            node["order"] = order
        return {
            "id": "00000000-0000-4000-8000-000000000000", "revision": 0,
            "last_node_id": len(self.nodes), "last_link_id": len(self.links),
            "nodes": self.nodes, "links": self.links, "groups": self.groups, "config": {},
            "extra": {"ds": {"scale": 0.7, "offset": [0, 0]}}, "version": 0.4,
        }


def loaders(graph: Graph, note: str) -> dict:
    """Model loading plus the LoRA patch the official subgraph keeps out of reach."""
    unet = graph.add("UNETLoader", (40, 120), (400, 82), [UNET, "default"])
    lora = graph.add("LoraLoaderModelOnly", (40, 250), (400, 82), [LORA, LORA_STRENGTH],
                     extra={"color": "#232", "bgcolor": "#353"})
    clip = graph.add("CLIPLoader", (40, 380), (400, 106), [CLIP, "qwen_image", "default"])
    vae = graph.add("VAELoader", (40, 530), (400, 58), [VAE])
    graph.connect(unet, "MODEL", lora, "model")
    graph.group("Step1 - 载入模型与 LoRA", [20, 40, 440, 580])
    graph.note((40, 660), note)
    return {"unet": unet, "lora": lora, "clip": clip, "vae": vae}


TEXT_PROMPT = "一个穿黄色雨衣的女孩，站在公交站旁，手持一把蓝色雨伞。"
EDIT_PROMPT = ("保持 <image1> 中人物的脸部、发型、体型和姿势不变，把 <image2> 中的浅蓝色牛仔衬衫穿到人物身上，"
               "衣服贴合身体、布料纹理自然，保留原有背景与光线。")

SHARED_NOTE = f"""## LoRA

`LoraLoaderModelOnly` 接在扩散模型和采样器之间，是官方子图内部被折叠的那条 MODEL 连线。

- 默认加载 `{LORA}`，强度 {LORA_STRENGTH}；强度 0 等于不加载。
- 选中节点按 Ctrl+B 可旁路（Bypass），用来做同 seed 的开关对照。
- 需要多个 LoRA 时复制该节点串联：模型 → LoRA1 → LoRA2 → 采样器。
- LoRA 只打模型权重，不改文本编码器；Qwen-Image-2.1 的 LoRA 需按 `qwen_image_2` 架构训练。

## 模型

- diffusion_models：`{UNET}`
- text_encoders：`{CLIP}`
- vae：`{VAE}`

## 采样

官方模板为 25 步，官方管线与本应用使用 40 步；euler / simple、CFG 1。CFG 为 1 时负面提示词不生效。
种子默认固定为 {SEED}，方便与应用生成结果对照。"""

T2I_NOTE = SHARED_NOTE + """

## 尺寸与透明

分辨率选择器按宽高比和百万像素给出宽高，1.0 MP ≈ 1024×1024，原生 2K 用 4.0 MP。
需要透明背景时在提示词中写明 RGBA 与 alpha 通道，并保存为 PNG。"""

EDIT_NOTE = SHARED_NOTE + """

## 参考图

- `images.image_1` 是编辑目标，其余为参考图，提示词用 `<image1>`、`<image2>` 指代。
- 再拖一条 IMAGE 连线到编码器空槽即可增加参考图，最多 16 张。
- `resolution` 是参考图处理的总像素预算，官方默认 1024，设为 0 表示保持原尺寸。
- `ComfySwitchNode` 的 switch 为 false 时画布跟随 image_1；改为 true 则使用分辨率选择器的宽高，
  两者差距过大会让编辑结果偏移。"""


def build_text_to_image() -> dict:
    graph = Graph()
    parts = loaders(graph, T2I_NOTE)
    encode = graph.add("TextEncodeQwenImage21", (500, 120), (460, 400), [TEXT_PROMPT, "", 1024],
                       sockets=text_encode_sockets(0))
    resolution = graph.add("ResolutionSelector", (500, 580), (300, 190), ["1:1 (Square)", 1, 8],
                           extra={"showAdvanced": True})
    latent = graph.add("EmptyLatentImage", (500, 810), (300, 120), [1024, 1024, 1])
    sampler = graph.add("KSampler", (1020, 120), (300, 300),
                        [SEED, "fixed", STEPS, 1, "euler", "simple", 1])
    decode = graph.add("VAEDecode", (1020, 470), (300, 46))
    save = graph.add("SaveImageAdvanced", (1380, 120), (700, 640),
                     ["Qwen_image_2.1", "png", "8-bit", "sRGB"])
    graph.connect(parts["clip"], "CLIP", encode, "clip")
    graph.connect(resolution, "width", latent, "width")
    graph.connect(resolution, "height", latent, "height")
    graph.connect(parts["lora"], "MODEL", sampler, "model")
    graph.connect(encode, "positive", sampler, "positive")
    graph.connect(encode, "negative", sampler, "negative")
    graph.connect(latent, "LATENT", sampler, "latent_image")
    graph.connect(sampler, "LATENT", decode, "samples")
    graph.connect(parts["vae"], "VAE", decode, "vae")
    graph.connect(decode, "IMAGE", save, "images")
    graph.group("Step2 - 提示词与尺寸", [480, 40, 500, 910])
    graph.group("Step3 - 采样", [1000, 40, 340, 500])
    return graph.serialize()


def build_image_edit() -> dict:
    graph = Graph()
    parts = loaders(graph, EDIT_NOTE)
    first = graph.add("LoadImage", (500, 120), (300, 330), ["portrait_model_denim.png", "image"])
    second = graph.add("LoadImage", (500, 500), (300, 330), ["clothing_light_blue_denim_shirt.png", "image"])
    encode = graph.add("TextEncodeQwenImage21", (860, 120), (460, 420), [EDIT_PROMPT, "", 1024],
                       sockets=text_encode_sockets(2))
    resolution = graph.add("ResolutionSelector", (860, 600), (300, 190), ["1:1 (Square)", 1, 32],
                           extra={"showAdvanced": True})
    latent = graph.add("EmptyLatentImage", (860, 830), (300, 120), [1024, 1024, 1])
    switch = graph.add("ComfySwitchNode", (1220, 830), (280, 80), [False])
    cache = graph.add("QwenImage21Cache", (1380, 120), (300, 90), ["auto", "default"])
    sampler = graph.add("KSampler", (1380, 250), (300, 300),
                        [SEED, "fixed", STEPS, 1, "euler", "simple", 1])
    decode = graph.add("VAEDecode", (1380, 600), (300, 46))
    save = graph.add("SaveImageAdvanced", (1740, 120), (700, 640),
                     ["Qwen_image_2.1_edit", "png", "8-bit", "sRGB"])
    graph.connect(parts["clip"], "CLIP", encode, "clip")
    graph.connect(first, "IMAGE", encode, "images.image_1")
    graph.connect(second, "IMAGE", encode, "images.image_2")
    graph.connect(parts["vae"], "VAE", encode, "vae")
    graph.connect(resolution, "width", latent, "width")
    graph.connect(resolution, "height", latent, "height")
    graph.connect(encode, "latent", switch, "on_false")
    graph.connect(latent, "LATENT", switch, "on_true")
    graph.connect(parts["lora"], "MODEL", cache, "model")
    graph.connect(cache, "MODEL", sampler, "model")
    graph.connect(encode, "positive", sampler, "positive")
    graph.connect(encode, "negative", sampler, "negative")
    graph.connect(switch, "output", sampler, "latent_image")
    graph.connect(sampler, "LATENT", decode, "samples")
    graph.connect(parts["vae"], "VAE", decode, "vae")
    graph.connect(decode, "IMAGE", save, "images")
    graph.group("Step2 - 参考图与指令", [480, 40, 840, 930])
    graph.group("Step3 - 采样", [1360, 40, 340, 630])
    return graph.serialize()


WORKFLOWS = {
    "image_qwen_image_2_1_t2i.json": build_text_to_image,
    "image_qwen_image_2_1_image_edit.json": build_image_edit,
}


def api_node(node_id: str, class_type: str, title: str, inputs: dict) -> tuple[str, dict]:
    return node_id, {"class_type": class_type, "inputs": inputs, "_meta": {"title": title}}


def build_api_template(editing: bool) -> dict:
    """The same graph in API form; node ids and titles are the adapter's contract."""
    prompt = EDIT_PROMPT if editing else TEXT_PROMPT
    encode = {"clip": ["2", 0], "prompt": prompt, "negative_prompt": "", "resolution": 1024}
    if editing:  # The encoder only takes the VAE and references when editing.
        encode["vae"] = ["3", 0]
    nodes = [
        api_node("1", "UNETLoader", "qwen_model", {"unet_name": UNET, "weight_dtype": "default"}),
        api_node("100", "LoraLoaderModelOnly", "qwen_lora_1",
                 {"model": ["1", 0], "lora_name": LORA, "strength_model": LORA_STRENGTH}),
        api_node("2", "CLIPLoader", "qwen_text_encoder",
                 {"clip_name": CLIP, "type": "qwen_image", "device": "default"}),
        api_node("3", "VAELoader", "qwen_vae", {"vae_name": VAE}),
        api_node("4", "TextEncodeQwenImage21", "qwen_prompt", encode),
        api_node("5", "EmptyLatentImage", "qwen_latent", {"width": 1024, "height": 1024, "batch_size": 1}),
        api_node("6", "KSampler", "qwen_sampler", {
            "model": ["9" if editing else "100", 0], "positive": ["4", 0], "negative": ["4", 1],
            "latent_image": ["4", 2] if editing else ["5", 0], "seed": SEED, "steps": STEPS, "cfg": 1,
            "sampler_name": "euler", "scheduler": "simple", "denoise": 1,
        }),
        api_node("7", "VAEDecode", "qwen_decode", {"samples": ["6", 0], "vae": ["3", 0]}),
        api_node("8", "SaveImageAdvanced", "保存图像", {
            "images": ["7", 0], "filename_prefix": f"ai_draw_qwen21{'_edit' if editing else ''}",
            "format": "png", "format.bit_depth": "8-bit", "format.input_color_space": "sRGB",
        }),
    ]
    if editing:
        nodes.append(api_node("9", "QwenImage21Cache", "qwen_cache",
                              {"model": ["100", 0], "device": "auto", "dtype": "default"}))
    return dict(nodes)


API_TEMPLATES = {
    "qwen_image_21_t2i_workflow_api.json": lambda: build_api_template(False),
    "qwen_image_21_i2i_workflow_api.json": lambda: build_api_template(True),
}


def dump_api(graph: dict) -> str:
    """One node per line, as the other workflow templates in this repository are written."""
    body = ",\n".join(f"  {json.dumps(key)}: {json.dumps(node, ensure_ascii=False)}"
                      for key, node in graph.items())
    return "{\n" + body + "\n}\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("/opt/comfyui/storage-user/workflows"))
    parser.add_argument("--api-output", type=Path,
                        default=Path(__file__).resolve().parents[1] / "configs/workflows")
    arguments = parser.parse_args()
    for directory, builders in ((arguments.output, WORKFLOWS), (arguments.api_output, API_TEMPLATES)):
        directory.mkdir(parents=True, exist_ok=True)
        for name, build in builders.items():
            graph = build()
            path = directory / name
            editor = "nodes" in graph
            path.write_text(json.dumps(graph, ensure_ascii=False, indent=2) + "\n" if editor
                            else dump_api(graph), encoding="utf-8")
            print(f"{path}: {len(graph['nodes']) if editor else len(graph)} nodes")


if __name__ == "__main__":
    main()
