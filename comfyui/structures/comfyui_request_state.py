class ComfyUIRequestState:
    """
    ComfyUI请求状态类，用于表示ComfyUI服务的状态信息。
    """

    def __init__(self, type_: str, api_address: str, available: bool = False, status: str = "offline"):
        self.type = type_
        self.available = available
        self.server_address = api_address
        self.status = status

    def to_dict(self):
        return {
            "type": self.type,
            "available": self.available,
            "server_address": self.server_address,
            "status": self.status
        }
