"""HTTP access to ai-draw with both error envelopes, safe retries and atomic downloads."""
import ipaddress
import time
from pathlib import Path
from typing import Iterable, Optional
from urllib.parse import urlparse

import requests

from .errors import ApiError, CliError, EXIT_API, EXIT_AUTH

IDEMPOTENT = {"GET", "PUT", "DELETE", "HEAD"}
RETRY_STATUSES = {502, 503, 504}


def is_loopback(url: str) -> bool:
    host = urlparse(url).hostname or ""
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def error_detail(response: requests.Response) -> str:
    try:
        data = response.json()
    except ValueError:
        return (response.text or response.reason or "").strip()[:500]
    if isinstance(data, dict):
        if isinstance(data.get("detail"), str):
            return data["detail"]
        if isinstance(data.get("detail"), list):
            return "; ".join(str(item.get("msg", item)) for item in data["detail"] if isinstance(item, dict)) or str(data["detail"])
        error = data.get("error")
        if isinstance(error, dict):
            details = error.get("details") or {}
            errors = details.get("errors") if isinstance(details, dict) else None
            if isinstance(errors, list) and errors:
                return "; ".join(f"{item.get('field')}: {item.get('message')}" for item in errors if isinstance(item, dict))
            return str(error.get("message") or error)
    return str(data)[:500]


class Client:
    def __init__(self, config: dict, token: Optional[str], session: Optional[requests.Session] = None):
        self.config = config
        self.token = token
        self.http = session or requests.Session()

    def url(self, path: str) -> str:
        return path if path.startswith(("http://", "https://")) else f"{self.config['api_url']}{path}"

    def _headers(self, auth: bool) -> dict:
        if not auth:
            return {}
        if not self.token:
            raise CliError("还没有配置 ai-draw 访问令牌：先运行 aidraw auth setup --user <账号>", EXIT_AUTH)
        api_url = self.config["api_url"]
        if api_url.startswith("http://") and not is_loopback(api_url):
            raise CliError(f"拒绝通过明文 HTTP 向非本机地址发送令牌：{api_url}", EXIT_AUTH)
        return {"Authorization": f"Bearer {self.token}"}

    def request(self, method: str, path: str, *, json=None, params=None, files=None, timeout: float = 60,
                auth: bool = True, allow: Iterable[int] = (), attempts: int = 4) -> requests.Response:
        """Return the response; raise ApiError unless the status is OK or listed in `allow`."""
        method = method.upper()
        headers = self._headers(auth)
        delay = 1.0
        for attempt in range(1, attempts + 1):
            try:
                response = self.http.request(method, self.url(path), json=json, params=params, files=files,
                                             headers=headers, timeout=timeout)
            except (requests.ConnectionError, requests.Timeout) as error:
                # A POST may already have been applied; only repeat requests that are safe to repeat.
                if method not in IDEMPOTENT or attempt == attempts:
                    raise CliError(f"无法连接 ai-draw（{self.config['api_url']}）：{error}", EXIT_API) from error
            else:
                if response.status_code in RETRY_STATUSES and method in IDEMPOTENT and attempt < attempts:
                    pass
                elif response.ok or response.status_code in allow:
                    return response
                else:
                    raise ApiError(response.status_code, error_detail(response))
            time.sleep(delay)
            delay = min(delay * 2, 15)
        raise CliError("请求失败", EXIT_API)

    def json(self, method: str, path: str, **kwargs):
        response = self.request(method, path, **kwargs)
        try:
            return response.json()
        except ValueError as error:
            raise CliError(f"ai-draw 返回了无法解析的内容：{response.text[:200]}", EXIT_API) from error

    def download(self, media_url: str, target: Path) -> Path:
        """Fetch an /uploads file (served without auth) atomically to `target`."""
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_name(f".{target.name}.part")
        try:
            response = self.request("GET", media_url, auth=False, timeout=300)
            partial.write_bytes(response.content)
            partial.replace(target)
        finally:
            partial.unlink(missing_ok=True)
        return target
