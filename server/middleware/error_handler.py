"""
统一异常处理中间件
"""
from fastapi import Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi import HTTPException
from sqlalchemy.exc import SQLAlchemyError
import logging
from typing import Union

logger = logging.getLogger(__name__)
REQUEST_ID_HEADER = "X-Request-Id"


def _get_request_id(request: Request) -> str:
    return getattr(getattr(request, "state", None), "request_id", "") or ""


def _json_error(
    *,
    status_code: int,
    request_id: str,
    error_code: str,
    message: str,
    details: dict | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        headers={REQUEST_ID_HEADER: request_id} if request_id else None,
        content={
            "success": False,
            "request_id": request_id,
            "error": {
                "code": error_code,
                "message": message,
                "details": details or {},
            },
        },
    )


class APIException(Exception):
    """自定义 API 异常基类"""
    def __init__(
        self,
        message: str,
        status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR,
        error_code: str = "INTERNAL_ERROR",
        details: dict = None
    ):
        self.message = message
        self.status_code = status_code
        self.error_code = error_code
        self.details = details or {}
        super().__init__(self.message)


class AuthenticationError(APIException):
    """认证错误"""
    def __init__(self, message: str = "认证失败", details: dict = None):
        super().__init__(
            message=message,
            status_code=status.HTTP_401_UNAUTHORIZED,
            error_code="AUTHENTICATION_ERROR",
            details=details
        )


class AuthorizationError(APIException):
    """权限错误"""
    def __init__(self, message: str = "权限不足", details: dict = None):
        super().__init__(
            message=message,
            status_code=status.HTTP_403_FORBIDDEN,
            error_code="AUTHORIZATION_ERROR",
            details=details
        )


class ResourceNotFoundError(APIException):
    """资源不存在"""
    def __init__(self, message: str = "资源不存在", details: dict = None):
        super().__init__(
            message=message,
            status_code=status.HTTP_404_NOT_FOUND,
            error_code="RESOURCE_NOT_FOUND",
            details=details
        )


class ValidationError(APIException):
    """数据验证错误"""
    def __init__(self, message: str = "数据验证失败", details: dict = None):
        super().__init__(
            message=message,
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            error_code="VALIDATION_ERROR",
            details=details
        )


class DatabaseError(APIException):
    """数据库错误"""
    def __init__(self, message: str = "数据库操作失败", details: dict = None):
        super().__init__(
            message=message,
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            error_code="DATABASE_ERROR",
            details=details
        )


class ExternalServiceError(APIException):
    """外部服务错误（如 ComfyUI, AI Prompt）"""
    def __init__(self, message: str = "外部服务调用失败", details: dict = None):
        super().__init__(
            message=message,
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            error_code="EXTERNAL_SERVICE_ERROR",
            details=details
        )


async def api_exception_handler(request: Request, exc: APIException) -> JSONResponse:
    """自定义 API 异常处理器"""
    request_id = _get_request_id(request)
    logger.error(
        f"API Exception: {exc.error_code} - {exc.message}",
        extra={
            "request_id": request_id,
            "path": request.url.path,
            "method": request.method,
            "error_code": exc.error_code,
            "details": exc.details
        }
    )

    return _json_error(
        status_code=exc.status_code,
        request_id=request_id,
        error_code=exc.error_code,
        message=exc.message,
        details=exc.details,
    )


async def validation_exception_handler(
    request: Request,
    exc: RequestValidationError
) -> JSONResponse:
    """FastAPI 验证错误处理器"""
    request_id = _get_request_id(request)
    errors = []
    for error in exc.errors():
        errors.append({
            "field": ".".join(str(loc) for loc in error["loc"]),
            "message": error["msg"],
            "type": error["type"]
        })
    
    logger.warning(
        f"Validation Error: {request.url.path}",
        extra={"request_id": request_id, "errors": errors}
    )

    return _json_error(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        request_id=request_id,
        error_code="VALIDATION_ERROR",
        message="请求数据验证失败",
        details={"errors": errors},
    )


async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    request_id = _get_request_id(request)
    status_code = exc.status_code
    error_code = "HTTP_ERROR"
    if status_code == status.HTTP_400_BAD_REQUEST:
        error_code = "BAD_REQUEST"
    elif status_code == status.HTTP_401_UNAUTHORIZED:
        error_code = "AUTHENTICATION_ERROR"
    elif status_code == status.HTTP_403_FORBIDDEN:
        error_code = "AUTHORIZATION_ERROR"
    elif status_code == status.HTTP_404_NOT_FOUND:
        error_code = "RESOURCE_NOT_FOUND"
    elif status_code == status.HTTP_422_UNPROCESSABLE_ENTITY:
        error_code = "VALIDATION_ERROR"

    message = exc.detail if isinstance(exc.detail, str) else "请求失败"
    logger.warning(
        f"HTTPException: {status_code} {message}",
        extra={"request_id": request_id, "path": request.url.path, "method": request.method},
    )
    return _json_error(
        status_code=status_code,
        request_id=request_id,
        error_code=error_code,
        message=message,
        details={"detail": exc.detail} if not isinstance(exc.detail, str) else {},
    )


async def sqlalchemy_exception_handler(
    request: Request,
    exc: SQLAlchemyError
) -> JSONResponse:
    """SQLAlchemy 异常处理器"""
    request_id = _get_request_id(request)
    logger.error(
        f"Database Error: {str(exc)}",
        extra={
            "request_id": request_id,
            "path": request.url.path,
            "method": request.method
        },
        exc_info=True
    )

    return _json_error(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        request_id=request_id,
        error_code="DATABASE_ERROR",
        message="数据库操作失败",
    )


async def general_exception_handler(
    request: Request,
    exc: Exception
) -> JSONResponse:
    """通用异常处理器"""
    request_id = _get_request_id(request)
    logger.error(
        f"Unhandled Exception: {str(exc)}",
        extra={
            "request_id": request_id,
            "path": request.url.path,
            "method": request.method
        },
        exc_info=True
    )

    return _json_error(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        request_id=request_id,
        error_code="INTERNAL_ERROR",
        message="服务器内部错误",
    )


def register_exception_handlers(app):
    """注册所有异常处理器"""
    from fastapi.exceptions import RequestValidationError
    from sqlalchemy.exc import SQLAlchemyError
    from fastapi import HTTPException
    
    # 自定义异常
    app.add_exception_handler(APIException, api_exception_handler)
    
    # FastAPI 验证异常
    app.add_exception_handler(RequestValidationError, validation_exception_handler)

    # HTTPException
    app.add_exception_handler(HTTPException, http_exception_handler)
    
    # SQLAlchemy 异常
    app.add_exception_handler(SQLAlchemyError, sqlalchemy_exception_handler)
    
    # 通用异常（兜底）
    app.add_exception_handler(Exception, general_exception_handler)
