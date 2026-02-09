import base64
import io
import json
import urllib.error
import urllib.request
from PIL import Image


def main() -> None:
    img = Image.new("RGB", (256, 256), (180, 180, 180))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    reference_image = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

    payload = {
        "prompt": "把这张线稿上色，扁平插画风",
        "workflow": "templates-color_api",
        "strength": 0.5,
        "count": 1,
        "lora_prompt": "",
        "reference_image": reference_image,
    }

    req = urllib.request.Request(
        "http://127.0.0.1:14600/api/image/generate",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )

    try:
        resp = urllib.request.urlopen(req, timeout=180)
        raw_text = resp.read().decode()
        print("status", resp.status)
        print(raw_text[:1200])
        data = json.loads(raw_text)
        if data.get("images"):
            img_b64 = str(data["images"][0]).split(",", 1)[1]
            png = base64.b64decode(img_b64)
            idx = png.find(b"\"class_type\":\"LoadImage\"")
            idx2 = png.find(b"\"image\":\"")
            print("has_loadimage", idx != -1)
            if idx2 != -1:
                snippet = png[idx2:idx2 + 160]
                print("image_snippet", snippet.decode("utf-8", errors="ignore"))
    except urllib.error.HTTPError as e:
        print("status", e.code)
        print(e.read().decode()[:4000])


if __name__ == "__main__":
    main()
