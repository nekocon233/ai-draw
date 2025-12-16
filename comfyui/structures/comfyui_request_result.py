class ComfyUIRequestResult:
    """
    Comfy请求结果封装类。
    """

    def __init__(self, success: bool, data=None, error: str = ""):
        self.is_success = success
        self.data = data
        self.error = error

    def to_dict(self):
        return {
            "success": self.is_success,
            "data": self.data,
            "error": self.error
        }

    def __repr__(self):
        return f"<ComfyRequestResult success={self.is_success} error='{self.error}'>"
