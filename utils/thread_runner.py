import threading
import asyncio
import traceback


class ThreadRunner:
    """
    工具类：在新线程中运行异步函数，避免阻塞主线程。
    确保所有异步任务在同一个事件循环中运行。
    """

    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super(ThreadRunner, cls).__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True

        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self.run_loop, daemon=True)
        self.thread.start()

    def run_loop(self):
        asyncio.set_event_loop(self.loop)
        self.loop.run_forever()

    def run_thread_async(self, func, prefix):
        async def wrapped_func():
            print(f"{prefix} 正在开始...")
            try:
                await func()
                print(f"{prefix} 已完成")
            except Exception as e:
                print(f"{prefix} 发生异常: {e}")
                traceback.print_exc()

        future = asyncio.run_coroutine_threadsafe(wrapped_func(), self.loop)
        return future

    @staticmethod
    def instance():
        return ThreadRunner()
