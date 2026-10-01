import asyncio
import unittest

from comfyui.comfyui_service import ComfyUIService


class RecordingRequest:
    def __init__(self):
        self.workflows = []

    def close_connect(self):
        pass

    async def generate_qwen_image_21(self, workflow, *args):
        self.workflows.append(workflow)

        class Result:
            is_success = True
            data = "image"
            error = None

        return Result()


class ComfyUIServiceTests(unittest.TestCase):
    def test_generation_after_pause_and_resume_reloads_the_removed_workflow_copy(self):
        request = RecordingRequest()
        service = ComfyUIService(request)
        workflow_type = service.get_current_workflow_type()
        # Pausing drawing (stop_service) deletes the temporary copy; resuming does not reload it.
        service.close_connect()
        self.assertIsNone(service.temp_workflow_file)
        service.switch_workflow(workflow_type)
        results = []
        asyncio.run(service.generate_qwen_image_21(results.append, "prompt", [], []))
        self.assertEqual(results, ["image"])
        self.assertEqual(len(request.workflows), 1)
        self.assertEqual(service.get_current_workflow_type(), workflow_type)
        service.close_connect()


if __name__ == "__main__":
    unittest.main()
