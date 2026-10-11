"""Read-only recovery of legacy composer inputs; an explicit empty draft is authoritative."""
from copy import deepcopy


COMPOSER_FIELDS = (
    'prompt', 'reference_image_end', 'motion_reference_images',
    'motion_reference_video', 'motion_prompt',
)

# Reading retired histories must not require registering their former providers.
LEGACY_VIDEO_WORKFLOWS = frozenset({'flf2v', 'i2v', 'pixel_lab_animate'})


def session_input_group(workflow: str | None, metadata: dict) -> str:
    output_type = metadata.get(workflow, {}).get('output_type')
    return 'video' if output_type == 'video' or (output_type is None and workflow in LEGACY_VIDEO_WORKFLOWS) else 'image'


def restore_session_input(config: dict, metadata: dict, latest: dict | None) -> dict:
    result = deepcopy(config)
    workflow = config.get('workflow') or (latest or {}).get('workflow')
    group = session_input_group(workflow, metadata)
    drafts = config.get('input_drafts')
    draft = drafts.get(group) if isinstance(drafts, dict) else None

    if config.get('prompt') is None:
        if isinstance(draft, dict) and isinstance(draft.get('prompt'), str):
            # Mirrors carry input only. Per-session generation settings remain authoritative.
            for field in COMPOSER_FIELDS:
                if field in draft:
                    result[field] = deepcopy(draft[field])
            result['reference_images'] = deepcopy(draft.get('reference_images'))
            for field in ('reference_image', 'reference_image_2', 'reference_image_3'):
                result[field] = draft.get(field)
            if result.get('workflow') is None:
                result['workflow'] = workflow
        elif latest:
            previous_workflow = latest.get('workflow')
            same_method = not config.get('workflow') or workflow == previous_workflow or (
                metadata.get(workflow, {}).get('method_group') is not None
                and metadata.get(workflow, {}).get('method_group') == metadata.get(previous_workflow, {}).get('method_group')
            )
            reference_fields = ('reference_images', 'reference_image', 'reference_image_2', 'reference_image_3')
            references_saved = any(config.get(name) is not None for name in reference_fields)
            for field, value in latest.items():
                if field not in result or result[field] is not None:
                    continue
                if not same_method and field in ('lora_prompt', 'workflow_options', 'motion_prompt'):
                    continue
                if field in reference_fields and references_saved:
                    continue
                result[field] = deepcopy(value)
            # A cancelled preset is a saved choice, including when the old prompt is NULL.
            choices = config.get('prompt_preset_choices')
            choices = choices if isinstance(choices, dict) else {}
            if result.get('workflow') in choices:
                result['prompt_preset'] = deepcopy(choices[result['workflow']])
            elif not same_method:
                result['prompt_preset'] = config.get('prompt_preset')

    if result.get('reference_images') is None:
        result['reference_images'] = [result.get(name) for name in ('reference_image', 'reference_image_2', 'reference_image_3')]
    return result
