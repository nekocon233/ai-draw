"""Shared preparation and output pipeline, independent of provider-specific APIs."""
import asyncio
import base64
from io import BytesIO
from typing import Callable

from PIL import Image
from utils.image_reference import normalize_image_reference

from .contracts import GenerationParameters, ProviderInput, TaskContext
from .storage import ArtifactStorage
from .workflows import WorkflowCatalog


class GenerationEngine:
    def __init__(self, catalog: WorkflowCatalog, storage: ArtifactStorage):
        self.catalog = catalog
        self.storage = storage

    def validate(self, parameters: GenerationParameters) -> None:
        self.catalog.validate(parameters)

    async def prepare(self, parameters: GenerationParameters, progress: Callable[[str], None]) -> GenerationParameters:
        enrich = self.catalog.registration(parameters.workflow).enrich
        if enrich is None:
            return parameters
        request, _ = await asyncio.to_thread(self._provider_input, parameters)
        prepared = await enrich(request, progress)
        self.catalog.validate(prepared)
        return prepared

    def _provider_input(self, parameters):
        metadata = self.catalog.metadata(parameters.workflow)
        references = [
            normalize_image_reference(value, str(self.storage.upload_dir), label) if value else None
            for value, label in (
                (parameters.reference_image, "参考图 1"), (parameters.reference_image_2, "参考图 2"),
                (parameters.reference_image_3, "参考图 3"), (parameters.reference_image_end, "尾帧参考图"),
            )
        ]
        size = None
        if metadata.get("supports_original_size"):
            if parameters.use_original_size and references[0]:
                with Image.open(BytesIO(base64.b64decode(references[0]))) as image:
                    size = image.size
            elif not parameters.use_original_size and parameters.width and parameters.height:
                size = (parameters.width, parameters.height)
        motion_images = tuple(
            normalize_image_reference(value, str(self.storage.upload_dir), f"动作参考 {index + 1}")
            for index, value in enumerate(parameters.motion_reference_images or ())
        )
        return ProviderInput(parameters, tuple(references[:3]), references[3], motion_images), size

    async def generate(
        self,
        parameters: GenerationParameters,
        context: TaskContext,
        on_artifact: Callable[[str, int, int], None],
        check_cancelled: Callable[[], None],
    ) -> list[str]:
        parameters = parameters.for_provider()
        metadata = self.catalog.metadata(parameters.workflow)
        registration = self.catalog.registration(parameters.workflow)
        if registration.prepare:
            registration.prepare(parameters.workflow)

        provider_input, target_size = await asyncio.to_thread(self._provider_input, parameters)
        results = []
        for index in range(parameters.count):
            check_cancelled()
            output = await registration.provider.generate(provider_input)
            check_cancelled()
            expected = metadata.get("output_type", "image")
            if output.kind != expected or not output.content:
                raise RuntimeError(f"生成服务返回了无效的 {expected} 结果")
            url = await self.storage.save(
                output, context.user_id, target_size,
                resize_mode=metadata.get("output_resize_mode", "cover"),
            )
            # Register each file immediately so later failures can clean partial batches.
            on_artifact(url, index, parameters.count)
            results.append(url)
        return results

    async def interrupt(self, workflow: str, runner: asyncio.Task) -> None:
        interrupt = self.catalog.registration(workflow).interrupt
        if interrupt:
            await interrupt(runner)
