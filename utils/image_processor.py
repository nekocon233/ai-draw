import base64
import io
from PIL import Image


class ImageProcessor:
    """
    处理图像的工具类，提供图像转换、调整大小、格式转换等功能
    """

    def __init__(self):
        """初始化图像处理器"""
        self.width = 1024
        self.height = 1024

    def resize(self, base64_content, target_size=None, crop_box=None):
        """
        调整图像大小和/或裁剪图像

        Args:
            base64_content: base64编码的图像内容
            target_size: 目标尺寸 (width, height)
            crop_box: 裁剪区域 (left, top, right, bottom)

        Returns:
            调整后的图像的base64编码字符串
        """

        image = Image.open(io.BytesIO(base64.b64decode(base64_content)))
        if crop_box:
            image = image.crop(crop_box)
        if target_size:
            image = image.resize(target_size, Image.LANCZOS)
        buf = io.BytesIO()
        image.save(buf, format='PNG')
        return base64.b64encode(buf.getvalue()).decode('utf-8')

    def prepare_image_base64(self, image):
        """
        处理图像以适应指定尺寸

        输入PIL.Image对象，输出处理后base64字符串
        等比缩放确保宽高都小于width/height，然后居中填充白底
        同时返回图像的有效区域坐标，用于后续裁剪

        Args:
            image: PIL.Image对象

        Returns:
            tuple: (处理后的base64字符串, 有效区域坐标元组)
        """

        image = image.convert('RGB')

        # 计算等比缩放后的尺寸，确保宽高都不超过目标尺寸
        img_width, img_height = image.size
        ratio = min(self.width / img_width, self.height / img_height)
        new_width = int(img_width * ratio)
        new_height = int(img_height * ratio)

        # 等比缩放图像
        image = image.resize((new_width, new_height), Image.LANCZOS)

        # 创建白色背景并居中粘贴图像
        new_img = Image.new('RGB', (self.width, self.height), (255, 255, 255))
        paste_x = (self.width - new_width) // 2
        paste_y = (self.height - new_height) // 2
        new_img.paste(image, (paste_x, paste_y))

        # 记录有效图像区域，用于后续裁剪
        valid_region = (paste_x, paste_y, paste_x + new_width, paste_y + new_height)

        buf = io.BytesIO()
        new_img.save(buf, format='PNG')
        return base64.b64encode(buf.getvalue()).decode('utf-8'), valid_region

    def convert_to_base64(self, image_base64):
        """
        将不同格式的图像输入统一转换为base64编码

        Args:
            image_base64: 图片base64字符串

        Returns:
            PIL.Image对象和图像原始尺寸
        """

        # 转为PIL.Image
        img = Image.open(io.BytesIO(base64.b64decode(image_base64)))
        return img, img.size
