# AGENTS.md

## Project Conventions

- Treat Docker as the source of truth for deployable builds.
- `docker-compose.yml` deploys through `DOCKER_HOST=ssh://nekocon-server`. On the development machine itself, the SSH alias `nekocon-server` is mapped to `127.0.0.1` in `~/.ssh/config`, so the same task deploys to the local Docker Engine. From another machine, that alias points at the real server. Do not add a second, parallel local Compose path.
- Deployment uses the complete current worktree, including uncommitted files. Inspect `git status` and `git diff`, preserve unrelated user changes, and never revert them.
- `docker compose build` does not restart services or refresh the `frontend-dist` volume consumed by Caddy.
- After implementation changes and local verification, run the VS Code task `deploy: remote` before reporting completion. Documentation-only changes do not require rebuilding the application image.
- The direct equivalent (Linux shell on the dev machine) is `DOCKER_HOST=ssh://nekocon-server docker compose down; docker volume rm --force ai-draw_frontend-dist; docker compose build; docker compose up -d`. On Windows PowerShell, set `$env:DOCKER_HOST="ssh://nekocon-server"` first.
- Deployment removes only `frontend-dist`. Preserve `postgres_data`, `uploads-data`, and `huggingface-cache` unless the user explicitly requests destructive cleanup.
- Manual production testing is normally performed at `https://aidraw.nekocon.cn/`.

## Project Overview

- ai-draw is a browser-based AI image/video generation and asset-processing workspace.
- The backend dispatches generation to ComfyUI and OpenAI-compatible image APIs; all text/vision LLM calls use the Codex proxy.
- The frontend is a React chat-style application with generation history, editing, media processing, and export tools.
- Authentication is mandatory in the current UI. JWT-authenticated user, session, message, configuration, and media metadata are persisted in PostgreSQL.
- Long-running generation executes inside the FastAPI process and reports state/results through WebSocket messages.

## Runtime Model

- `AIDrawService` is the process-global composition root. `server/generation/TaskManager` owns one generation slot with immutable user/session/message/task identity and explicit lifecycle phases. Generation events and snapshots are isolated by user; execution remains single-task.
- `POST /api/media/generate` schedules work through FastAPI `BackgroundTasks` and returns immediately. There is no durable queue, Redis worker, or retry worker.
- Restarting the backend loses active generation tasks. `/api/media/stop` checks task ownership and accepts an optional `task_id`; stopping during result persistence returns 409.
- `StateEvent` captures task identity before delivery. Private events require a user recipient; only explicitly allowed public service fields may broadcast. Prompt activity is tracked per user.

## Tech Stack

- Deploy build: Node 22 frontend stage and Python 3.10 backend/runtime stages.
- Backend: FastAPI, Uvicorn, SQLAlchemy 2.0, PostgreSQL 15, Pydantic v2, pydantic-settings, JWT via `python-jose`, WebSocket.
- AI integrations: ComfyUI, OpenAI-compatible APIs, the Codex proxy, and a latent PixelLab implementation that is not exposed by current workflow metadata.
- Media processing: Pillow, OpenCV headless, ffmpeg, rembg, transparent-background/InSPyReNet, BiRefNet, PyTorch.
- Frontend: React 19, TypeScript 5.9, Zustand 5, Ant Design 6, Axios, Vite 7.

## Backend Architecture

- `server/main.py`: FastAPI app, lifespan, CORS, exception handlers, `/api` router mounting, `/ws`, `/uploads`, and `/health`.
- `server/api/generation.py`: authenticated generation, last-task and stop endpoints mounted under `/api/media`; ownership validation stays at the HTTP boundary.
- `server/api/media.py`: reference upload, video-frame processing/export, background removal and image upscaling; composes the generation router.
- `server/api/prompt.py`: authenticated prompt generation, server-maintained prompt presets (`GET /api/prompt/presets`), image analysis, and ordered motion-reference analysis under `/api/prompt`. Presets describe the task only; painting style belongs to the selected LoRA. Every preset ends with "。": the selected preset is shown above the input, sent as `prompt_preset`, and `GenerationParameters.for_provider()` prepends it to the user's description only for validation and provider calls.
- `server/api/service.py`: public status/workflow metadata plus authenticated service controls under `/api/service`.
- `server/api/user.py`: `/api/auth`, `/api/config/user`, history persistence, and reference-image routes.
- `server/api/session.py`: `/api/chat/sessions`, session configuration, pinning, title summarization, message editing, round deletion, and the per-round outline (`GET /api/chat/sessions/{id}/outline`: prompt excerpt, preset title, workflow and first result URLs; it loads only those columns because legacy reference columns can hold base64).
- `server/api/__init__.py`: registers all REST routers under the `/api` prefix supplied by `server/main.py`.
- `server/schemas.py`: shared request/response models, including generation payloads.
- `server/ai_draw_service.py`: application composition, service controls, prompt generation and ComfyUI utility facade.
- `server/generation/`: task lifecycle, coordinator, provider registry/adapters, workflow catalog, artifact storage, result persistence and explicit event contracts. See `docs/architecture.md`.
- Use `get_ai_draw_service()` with FastAPI `Depends` rather than constructing another service instance.

## API And Authentication

- Public endpoints are `/api/auth/register`, `/api/auth/login`, `/api/service/status`, `/api/service/workflows`, `/api/service/workflow/defaults`, and `/health`.
- Registration requires the configured `INVITE_CODE`.
- Media, prompt, chat/session, user-config, reference-image, service-control, and WebSocket operations require authentication.
- `server/auth.py` provides `get_current_user` and `get_current_user_optional`; the optional dependency is currently unused by routes.
- The frontend presents a non-closable login/register modal when no valid JWT is available. Guest persistence branches remain in older frontend helpers but are not an active product mode.
- Use existing auth dependencies rather than parsing JWTs manually in route handlers.
- `server/middleware/error_handler.py` defines the preferred structured error envelope, but routes also use normal FastAPI `HTTPException` responses. Frontend code must continue handling both structured errors and `{"detail": "..."}`.

## Data Model And Schema Changes

- `User`: account data.
- `UserConfig`: per-user workflow and UI defaults.
- `ChatSession`: conversation metadata, pin state, and saved generation configuration.
- `ChatMessage`: user/assistant messages and generation parameters.
- `GeneratedImage`: generated image or video records despite the historical model name. Its nullable `seed` (BIGINT, idempotent startup DDL) records the seed each result actually used; edits, older results and seedless workflows store NULL.
- `ReferenceImage`: uploaded user reference media.
- Session configuration contains multi-reference images, optional start/end keyframes and workflow options. Legacy end-frame prompts, loop state, frame counts and frame rate remain as historical database fields only; current generation does not accept or restore them.
- Sessions and messages also persist width, height and original-size preference. Startup adds their nullable columns with idempotent DDL; missing historical sizes use workflow defaults in the frontend.
- The selected prompt preset is a JSON snapshot in `chat_sessions.config_prompt_preset` and `chat_messages.prompt_preset` (idempotent DDL); message `content` holds only the user's description.
- `chat_sessions.config_prompt_preset_choices` is a nullable JSON map of workflow IDs to preset snapshots; a missing key means uninitialized, and `null` means an explicit opt-out. Startup adds the column with idempotent DDL. Preserve this map through mode switches and session restore so defaults never undo a user's cancellation.
- `chat_sessions.config_input_drafts` is a nullable JSON map of `image` / `video` composer drafts: description, references, start/end frames, ordered motion images, motion-analysis snapshot and parked images. Image and video workflows (metadata `output_type`) keep independent composers. Switching between them stashes the live input and restores the other type's (empty the first time); switches within one type keep the existing carry/park behavior (`buildWorkflowTransition`, `utils/composerDrafts.ts`). The live type is mirrored too, so its parked images persist. Saves validate draft image ownership, media cleanup treats every draft image as referenced, and session deletion removes them. Startup adds the column with idempotent DDL.
- Startup calls `Base.metadata.create_all()` and applies explicit idempotent DDL for deployed schema additions such as `is_pinned`.
- Alembic is installed but the repository has no `alembic.ini`, migration environment, or versions directory. `create_all()` does not alter existing columns. Any real deployed schema change requires an explicit migration strategy.
- Startup also runs the idempotent migration in `server/legacy_media.py`: media from the retired style-reference table is appended to its owned assistant round, preserving existing results, before that legacy table is dropped. Historical workflow IDs remain in messages; unavailable workflows cannot be regenerated directly.

## Configuration

- `.env` is the source of truth for application/server settings, ports, database/auth settings, model configuration, external APIs, and paths.
- `.env.example` is the complete variable manifest. Keep it synchronized with every Pydantic Settings alias in `utils/config_loader.py`.
- Every declared environment field must exist. Optional integrations are disabled by leaving their API key empty, not by omitting variables; required model and URL fields must remain non-empty.
- `AI_PROMPT_PROVIDER=codex` is the only supported LLM provider. All text/vision calls use the existing GPT Image proxy connection with `CODEX_LLM_MODEL=gpt-6-astra`. Image generation keeps its own model selection.
- Legacy prompt/title connection settings have been removed; `scripts/migrate_chatgpt_env.py` migrates existing `.env` files without displaying credentials.
- `configs/app_config.yaml` should contain only workflow file mappings, metadata, parameter definitions, and workflow defaults.
- Important config groups include app/server, ComfyUI, Qwen-Image-2.1, AI prompt, Codex LLM, GPT Image, video frames/background removal, image upscale, auth, database, Redis, and paths.
- Redis settings are reserved configuration only. Redis is not deployed, imported, or used by application runtime.
- Only the local/HTTP ComfyUI request implementation exists. `COMFYUI_CLOUD_*` and `COMFYUI_ENABLED` are currently placeholders rather than effective backend switches.
- Do not commit `.env` or hardcode credentials, host-specific secrets, API keys, or model credentials.

## Workflows

- Workflow metadata lives at `configs/app_config.yaml` under `workflow_defaults.workflow_metadata`.
- Selectable workflow IDs are the metadata keys: `qwen_image_21_t2i`, `qwen_image_21_i2i`, `gpt_image`, `minimax_h3`, and `minimax_h3_ref`. The default is `qwen_image_21_t2i`.
- Z-Image (`t2i`) is retired from the application. Preserve its model/LoRA files, training data and outputs, and historical messages/media. Old sessions fall back to an available workflow without carrying over retired LoRAs; old messages cannot be regenerated directly.
- `qwen_image_21_t2i` / `qwen_image_21_i2i`: unified Qwen-Image-2.1 entry, separate native ComfyUI API graphs, up to three references in this app, optional compatible model-only LoRAs and RGBA PNG output. LoRAs are listed in `lora_models`; an entry may set `default_strength` (0.8 otherwise), used when a LoRA is first picked in an empty row, while switching an existing row to another LoRA keeps its strength. `Daikei` is the style-free v2 retrain (renamed from `DaikeiV2` on 2026-09-30, history migrated); the first version stays installed as `DaikeiV1.safetensors` but unlisted. Model filenames use `QWEN_IMAGE_21_*` settings. See `docs/qwen_image_21.md`; training uses AI Toolkit `arch: qwen_image_2`.
- `gpt_image`: OpenAI-compatible image generation/editing with optional multi-image input.
- Wan (`flf2v` / `i2v`) is retired. Its application graphs, provider/request code, loop/frame controls, dedicated prompt analysis, installed weights and saved ComfyUI workflows are removed. Preserve historical messages/media and legacy database fields; old sessions use the common workflow fallback and old messages cannot be regenerated directly. Keep shared ComfyUI nodes and upstream code intact.
- `minimax_h3`: displayed as `MiniMax H3 · 首尾帧`; ComfyUI MiniMax H3 text/optional-keyframe video with optional native audio.
- Both H3 workflows share the `h3_audio` select (`silent` by default, or `native`). H3 always samples audio jointly, so silent mode removes the `h3_decode_audio` node and muxes video without a track. Frames are unchanged. Sessions and messages without the key, including old history, are silent.
- Seeds use the metadata parameter type `seed`: `qwen_fixed_seed` (both Qwen executions) and `h3_fixed_seed` (both H3 workflows); `''` means random. Providers registered with `seed_option` receive `ProviderInput.seed` from `round_seeds`: a fixed seed gives result n seed + n − 1 (so it must leave room for the batch below 2^53), while random mode draws a distinct 32-bit seed for every result. Seeds travel with `media_generated`, task snapshots and `generated_images.seed`; history and round APIs return `seeds` parallel to `images`, and `/chat/save` accepts `seeds` to keep them aligned. The frontend keys `mediaSeeds` by result URL, shows a reusable seed badge on each result, tags fixed-seed rounds, and resets seeds to random for new sessions. The retired `qwen_seed` key stays filtered.
- `minimax_h3_ref`: H3 Ref2VA uses one character image and 1–8 ordered pose images directly as references. `motion_reference_images` is persisted in message/session JSON columns with idempotent startup DDL. Preserve image order and ownership in upload, history, regeneration and media cleanup. See `docs/minimax_h3_reference.md`.
- Ref2VA automatically analyzes the source scene and ordered poses through the existing Codex vision client before sampling. By default (`pose` mode) it preserves identity, background, lighting, camera, crop and source aspect ratio. `motion_prompt` stores the input-bound, editable analysis snapshot separately from the user's description. The generic provider enrichment stage runs inside the owned generation task; failed/cancelled analysis must never start video generation. Preview uses authenticated `/api/prompt/analyze-motion` with the same ownership checks.
- The current `video_fixed_camera` prompt preset declares `requires_motion_reference`: both UI and backend require a motion-capable workflow and ordered pose images. Reference images determine the actions, poses and order; user text only adds compatible timing, pauses or sound details. The motion-analysis policy identifier is included in backend/frontend input hashes to invalidate older analysis. Preserve saved preset snapshots; reselecting loads the latest preset.
- `video_reference_shot` (参考镜头动作) declares `motion_reference_mode: "shot"`: the subject image supplies only the character's or element's appearance, while camera, composition, poses, actions and scene follow the ordered references. `for_provider()` derives the non-persisted `GenerationParameters.motion_reference_mode`; snapshots without the field use `pose`. Shot mode switches the final prompt (`SHOT_REFERENCE_RULES` replaces `FIXED_SCENE_RULES`), the vision-analysis instructions, and the policy (`reference-shot-v1`, which keeps pose-mode hashes unchanged). It also makes the automatic canvas follow the first reference (`canvas_image_index=1`). `/api/prompt/analyze-motion` accepts `motion_reference_mode`, and the frontend mirrors the policy in `motionPromptSourceKey`.
- Current video presets declare `workflow_ids`: `video_motion` / `video_transition` only target `minimax_h3`, and `video_fixed_camera` / `video_reference_shot` only target `minimax_h3_ref`. The preset menu hides incompatible entries. Metadata `default_prompt_preset_id` selects `video_transition` for the frame mode and `video_fixed_camera` for the reference mode on first use; the input remains supplementary text. Old snapshots without scope keep their original capability validation for regeneration.
- Image workflows have no default preset (since 2026-09-29): first use starts with an empty description and no preset, and presets are chosen from the plus menu. Sessions that already recorded one, including the former `sketch_finish` default, keep it until the user removes it. Qwen's text/edit executions share manual preset choices and opt-outs across reference upload/removal; both workflow keys remain in the persisted map. GPT Image keeps its own choice. Preserve existing descriptions, snapshots and explicit cancellations.
- `pose_composition` (仅参考姿势构图) is an image preset that takes only pose, action, composition, camera angle and aspect ratio from reference 1. Appearance, clothing, colors and background come from the description, and rendering comes from the selected LoRA. Like `sketch_finish`, its prompt must contain no style terms (enforced in `tests/test_llm.py`).
- `workflow_files` also contains internal `image_upscale` and `image_upscale_invsr` workflows. They are utility workflows, not selectable generation modes.
- Current JSON files are `qwen_image_21_t2i_workflow_api.json`, `qwen_image_21_i2i_workflow_api.json`, `minimax_h3_workflow_api.json`, `minimax_h3_ref_workflow_api.json`, `image_upscale_workflow_api.json`, and `image_upscale_invsr_workflow_api.json`.
- Common metadata fields include `label`, `description`, `category`, `method`, input capability flags, `output_type`, `prompt_template`, and `parameters`.

## Adding A Workflow

- For a ComfyUI generation workflow, add the exported API JSON, register `workflow_files`, add `workflow_metadata`, and verify whether generic service dispatch supports its inputs and outputs.
- For an external API workflow, add environment-backed configuration, a provider adapter/registry entry and metadata with `provider`, plus request fields/types if needed. Do not add a dummy ComfyUI JSON or platform branches to the coordinator.
- For an internal utility workflow, add only the `workflow_files` mapping and consuming backend logic unless it should be selectable by users.
- Workflow discovery, provider resolution, validation and max_count share `WorkflowCatalog`; every selectable workflow must declare a registered `provider`. Audit specialized UI input behavior in `ChatInput.tsx` and `SettingsModal.tsx` when adding capabilities.

## Frontend Architecture

- `frontend/src/main.tsx`: React entry point and `ErrorBoundary` installation.
- `frontend/src/App.tsx`: authenticated application shell and theme/layout.
- `frontend/src/features/generation/`: generation store slice, event handling and connection hook. Use the slice actions for task transitions and result refreshes; preserve revision guards against stale responses.
- `frontend/src/stores/appStore.ts`: primary Zustand state and most current store types.
- `frontend/src/api/client.ts`: Axios setup, JWT injection, and mixed error-envelope handling.
- `frontend/src/api/services.ts`: REST methods for auth, sessions, generation, media utilities, and persistence.
- `frontend/src/api/websocket.ts`: authenticated WebSocket connection, browser connection ID, and reconnect handling.
- `frontend/src/types/api.ts` and `frontend/src/types/models.ts`: API and persisted model types.
- `frontend/src/types/store.ts` re-exports the active store type. Chat message types live in `types/models.ts`; transport types live in `types/api.ts`.
- `frontend/src/components/FrameExtractionModal.tsx`: frame extraction, workset selection, edits, background processing, upscaling, and export flow.
- `frontend/src/components/ResultGrid.tsx`: generated media display and entry points to media tools. Sending a round (`addChatMessage` increments `scrollToLatestRequest`) always scrolls to the bottom, even after the user scrolled up; new results only follow when the view is near the bottom. The list stays pinned to the bottom when the composer grows. Session switches restore the saved position.
- `frontend/src/components/RoundNavigator.tsx`: one tick per round beside the result scrollbar, vertically centered and compact (8px per round, at most 40% of the result area or 320px; ticks compress beyond that); hover previews, click jumps, touch taps pin the preview first. Unloaded earlier rounds come from the session outline, and jumping loads pages until the round renders. The rail ignores pointer events so wheel and touch scrolling stay native; hits are resolved by coordinates on `.results-area`. Jumps and sends bump ResultGrid's navigation token, which cancels queued follow-to-bottom scrolls and pending session-position restores.
- `frontend/src/components/ChatInput.tsx`: the composer. On phones (≤600px) its toolbar stays on one row: 参考图/姿势图 are icon-only, the workflow select shows only the category name (only its icon below 380px), and the tools scroll horizontally instead of wrapping. Check the width budget before adding toolbar buttons. Ant Design `autoSize` does not re-measure when a placeholder changes, so textareas with dynamic placeholders pass `autoSize` through `utils/placeholderAutoSize.ts`.
- `frontend/src/components/PromptExpansionModal.tsx`: 扩写助手, text expansion only in every workflow; keeps result editing, copying, applying and image-mention validation. Preset selection and the preset tag's change action use the input's plus menu. Motion analysis stays in the existing plus action and generation pipeline. An applicable selected preset is sent only as read-only `preset_prompt` context (a system message with image mentions as plain text); expansion rewrites only the user's description and never restates the preset, which generation still prepends once. The `minimax_h3_ref` template likewise leaves fixed-scene rules and reference actions to the server. A draft per session and input type (image/video: original description plus last result, `utils/promptExpansionDrafts.ts`, localStorage, latest 60 drafts, cleared on logout; an older session-only draft is handed to the other type on the first write) survives applying, closing and reloading. It starts only after the user expands, edits or imports text. A saved original is never replaced by the input automatically; "用输入框内容覆盖" does it manually, and the input only prefills when that session and type have no draft.
- `frontend/src/components/BackgroundOptionsFields.tsx`: shared background-removal controls.
- `frontend/src/utils/frameColorReplacement.ts` and `imageUpscale.ts`: client-side frame/color and upscale helpers.
- Preserve the existing Ant Design and product-specific interaction patterns unless the task explicitly requests a redesign.
- The current Vite development proxy targets `localhost:8000`, while `.env.example` defaults `SERVER_PORT` to `14600`. Align one side before local integrated testing.

## WebSocket Behavior

- `server/websocket/manager.py` owns user-scoped connection delivery; `routes.py` owns authenticated routes and the application event subscription.
- Connections require `/ws?token=<JWT>`; unauthenticated connections close with code `1008`.
- After connecting, the frontend sends an `init` message with a browser connection ID from local storage. This is not a database chat-session ID.
- The lifespan installs an event subscriber that sends immutable `StateEvent` payloads through `manager.publish()`. Private task messages only reach the owning user's authenticated connections.
- State messages use `{"type":"state_change","field":"is_generating","value":true}`.
- Generation errors use `{"type":"state_change","field":"error","value":"..."}`, not a top-level WebSocket `error` message.
- Useful log markers include `[WebSocket] 客户端已连接` and `[WebSocket] 会话ID已设置`.

## ComfyUI And API Integrations

- `comfyui/comfyui_service.py`: workflow loading, parameter injection, queueing, and output collection.
- `comfyui/requests/comfyui_request_interface.py`: request abstraction.
- `comfyui/requests/local_comfyui_request.py`: active HTTP ComfyUI implementation.
- Preserve existing UTF-8/GBK compatibility when touching temporary workflow files.
- In remote Docker, `COMFYUI_HOST=comfyui` works only if that hostname is reachable from `ai-draw-network`; this Compose file does not create a ComfyUI service.
- `utils/openai_image.py`: OpenAI-compatible image generation/editing.
- `utils/llm.py`: shared Codex text/vision client for prompts, titles, analysis and training captions.
- `utils/pixel_lab.py`: latent PixelLab integration, currently absent from selectable metadata.
- `utils/ai_prompt.py`: OpenAI-compatible prompt expansion.
- `utils/session_title.py`: automatic chat title generation.

## Media Processing And Storage

- `server/image_upscale_methods.py` registers Lanczos, APISR, Real-CUGAN, Real-ESRGAN, and InvSR capabilities.
- `utils/video_frames.py` implements probing, extraction, normalization, background removal, spritesheet/GIF/APNG construction, and ZIP export.
- `utils/media_processor.py` contains image/video resize and ffmpeg-backed helpers.
- `utils/image_reference.py` normalizes reference-image input and dimensions.
- `utils/thread_runner.py` provides a singleton event-loop thread for async work that must not block the FastAPI loop.
- `utils/file_storage.py` owns upload/generated media paths.
- `uploads/` is shared with Caddy and exposed under `/uploads` without per-request authorization.
- The `huggingface-cache` volume persists downloaded model weights across deployments.

## Verification

- Backend tests: `python -B -m unittest discover -s tests -p "test_*.py"`.
- Frontend tests: `npm --prefix frontend test`.
- Frontend lint: `npm --prefix frontend run lint`.
- Frontend production build: `npm --prefix frontend run build`.
- `npm run build` executes `tsc -b && vite build`.
- Docker is the final deployable build path; the Dockerfile builds the frontend but does not run backend or frontend unit tests.
- There is currently no CI workflow, backend formatter, backend linter, or backend type-check configuration.
- Report pre-existing lint/test failures accurately; do not fix unrelated backlog unless requested.

## Common Change Guides

- API endpoint: edit the relevant `server/api/` module, add shared schemas to `server/schemas.py`, apply auth dependencies, update frontend services/types, and register only genuinely new routers in `server/api/__init__.py`.
- Generation behavior: edit the relevant module under `server/generation/`; preserve ownership, lifecycle, preview/result, error, cancellation and persistence semantics. Do not reintroduce task fields or background business logic into HTTP/WebSocket routes.
- Database model: edit `server/models.py`, define how existing deployed databases migrate, and do not assume `create_all()` changes existing tables.
- Workflow UI: update metadata first, then audit hardcoded workflow-specific branches and persisted session configuration.
- WebSocket: inspect browser Network/WS frames and backend connection logs; verify authentication and cross-client behavior.
- Frame processing: keep backend request models, frontend staged state, undo/redo, progress polling, and export cleanup consistent.

## Key Files

- `.env.example`: complete environment variable manifest.
- `.vscode/tasks.json`: deploy, status, logs, and restart tasks (all via `DOCKER_HOST=ssh://nekocon-server`).
- `Dockerfile`: Node/Python multi-stage application image.
- `docker-compose.yml`: FastAPI/PostgreSQL/Caddy composition and persistent volumes.
- `caddy/Caddyfile`: HTTP routing, uploads, API, and WebSocket proxy behavior.
- `configs/app_config.yaml`: workflow mappings, metadata, and defaults.
- `configs/workflows/`: ComfyUI API JSON files.
- `server/main.py`: app lifecycle and router mounting.
- `server/ai_draw_service.py`: application composition and utility facade.
- `server/generation/`: generation orchestration and adapters.
- `server/api/`: REST routers.
- `server/models.py`: ORM models.
- `server/database.py`: engine, sessions, startup table creation, and idempotent DDL.
- `server/auth.py`: JWT authentication.
- `server/websocket/routes.py` and `manager.py`: WebSocket authentication and scoped event delivery.
- `utils/config_loader.py`: environment-backed configuration.
- `frontend/package.json`: frontend scripts and dependency versions.
- `frontend/vite.config.ts`: dev server and proxy ports.
- `frontend/src/App.tsx`: application shell.
- `frontend/src/stores/appStore.ts`: primary frontend state.
- `frontend/src/api/`: frontend REST and WebSocket clients.
- `frontend/src/components/`: chat, result, settings, and media-workbench UI.
- `tests/` and `frontend/tests/`: current unit tests.
