"""Exit codes are part of the contract with agents; keep them stable."""

EXIT_OK = 0
EXIT_USAGE = 1      # bad arguments or a local problem
EXIT_TIMEOUT = 2    # still running or still open; the output carries a resume command
EXIT_API = 3        # the server rejected the request
EXIT_CANCELLED = 4  # the user stopped the task, or the gate was cancelled or removed
EXIT_LOST = 5       # the backend restarted and the task left no results
EXIT_AUTH = 6       # missing, invalid or unsafe credentials
EXIT_SLOT = 7       # the generation slot stayed busy longer than allowed


class CliError(Exception):
    def __init__(self, message: str, code: int = EXIT_USAGE, **extra):
        super().__init__(message)
        self.code = code
        self.extra = extra


class ApiError(CliError):
    def __init__(self, status: int, detail: str):
        code = EXIT_AUTH if status == 401 else EXIT_API
        super().__init__(f"HTTP {status}: {detail}", code, status=status, detail=detail)
        self.status = status
        self.detail = detail
