# AGENTS.md

## Project Conventions

- Treat Docker as the source of truth for deployable builds.
- `docker-compose.yml` is exclusively for deployment through the SSH Docker Engine at `ssh://nekocon-server`. Do not add or restore a local Docker Compose deployment path.
- The remote deployment uses the complete current worktree, including uncommitted files. Inspect `git status` and `git diff`, preserve unrelated user changes, and never revert them.
- `docker compose build` does not restart services or refresh the `frontend-dist` volume consumed by Nginx.
- After implementation changes and local verification, run the VS Code task `deploy: remote` before reporting completion. Documentation-only changes do not require rebuilding the application image.
- The direct equivalent is `$env:DOCKER_HOST="ssh://nekocon-server"; docker compose down; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; docker volume rm --force ai-draw_frontend-dist; docker compose build; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; docker compose up -d`.
- Deployment removes only `frontend-dist`. Preserve `postgres_data`, `uploads-data`, and `huggingface-cache` unless the user explicitly requests destructive cleanup.
- Manual production testing is normally performed at `https://aidraw.nekocon.cn/`.

## Project Overview

- ai-draw is a browser-based AI image/video generation and asset-processing workspace.
- The backend dispatches generation to ComfyUI, Gemini/Nano Banana, OpenAI-compatible image APIs, and Kling.
- The frontend is a React chat-style application with generation history, editing, media processing, and export tools.
- Authentication is mandatory in the current UI. JWT-authenticated user, session, message, configuration, and media metadata are persisted in PostgreSQL.
- Long-running generation executes inside the FastAPI process and reports state/results through WebSocket messages.

## Runtime Model

- `AIDrawService` is a process-global singleton with one `is_generating` state and one current generation task. Generation state is not isolated per user or per chat session.
- `POST /api/media/generate` schedules work through FastAPI `BackgroundTasks` and returns immediately. There is no durable queue, Redis worker, or retry worker.
- Restarting the backend loses active generation tasks. `/api/media/stop` operates on the shared singleton task.
- Service callbacks currently broadcast WebSocket state to every authenticated connection. Do not put user-sensitive payloads into broadcasts without adding server-side user/task routing.

## Tech Stack

- Deploy build: Node 22 frontend stage and Python 3.10 backend/runtime stages.
- Backend: FastAPI, Uvicorn, SQLAlchemy 2.0, PostgreSQL 15, Pydantic v2, pydantic-settings, JWT via `python-jose`, WebSocket.
- AI integrations: ComfyUI, Google GenAI, OpenAI-compatible APIs, Kling, and a latent PixelLab implementation that is not exposed by current workflow metadata.
- Media processing: Pillow, OpenCV headless, ffmpeg, rembg, transparent-background/InSPyReNet, BiRefNet, PyTorch.
- Frontend: React 19, TypeScript 5.9, Zustand 5, Ant Design 6, Axios, Vite 7.

## Backend Architecture

- `server/main.py`: FastAPI app, lifespan, CORS, exception handlers, `/api` router mounting, `/ws`, `/uploads`, and `/health`.
- `server/api/media.py`: authenticated image/video generation, reference upload, stop, video-frame processing/export, background removal, and image upscaling under `/api/media`.
- `server/api/prompt.py`: authenticated prompt generation, pose preset, image analysis, and first/last-frame analysis under `/api/prompt`.
- `server/api/service.py`: public status/workflow metadata plus authenticated service controls under `/api/service`.
- `server/api/user.py`: `/api/auth`, `/api/config/user`, history persistence, and reference-image routes.
- `server/api/session.py`: `/api/chat/sessions`, session configuration, pinning, title summarization, message editing, and round deletion.
- `server/api/__init__.py`: registers all REST routers under the `/api` prefix supplied by `server/main.py`.
- `server/schemas.py`: shared request/response models, including generation payloads.
- `server/ai_draw_service.py`: generation dispatch, ComfyUI/API orchestration, shared task state, and state-change callbacks.
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
- `GeneratedImage`: generated image or video records despite the historical model name.
- `ReferenceImage`: uploaded user reference media.
- Session configuration contains multi-reference fields, start/end-frame prompts and images, loop state, frame counts, and frame rate where supported.
- Startup calls `Base.metadata.create_all()` and applies explicit idempotent DDL for deployed schema additions such as `is_pinned`.
- Alembic is installed but the repository has no `alembic.ini`, migration environment, or versions directory. `create_all()` does not alter existing columns. Any real deployed schema change requires an explicit migration strategy.

## Configuration

- `.env` is the source of truth for application/server settings, ports, database/auth settings, model configuration, external APIs, and paths.
- `.env.example` is the complete variable manifest. Keep it synchronized with every Pydantic Settings alias in `utils/config_loader.py`.
- Every declared environment field must exist. Optional integrations are disabled by leaving their API key empty, not by omitting variables; required model and URL fields must remain non-empty.
- `AI_PROMPT_REUSE_SESSION_TITLE=true` makes prompt generation reuse the session-title API key, base URL, and model.
- `configs/app_config.yaml` should contain only workflow file mappings, metadata, parameter definitions, and workflow defaults.
- Important config groups include app/server, ComfyUI, AI prompt, session title, Nano Banana, GPT Image, Kling, video frames/background removal, image upscale, auth, database, Redis, and paths.
- Redis settings are reserved configuration only. Redis is not deployed, imported, or used by application runtime.
- Only the local/HTTP ComfyUI request implementation exists. `COMFYUI_CLOUD_*` and `COMFYUI_ENABLED` are currently placeholders rather than effective backend switches.
- Do not commit `.env` or hardcode credentials, host-specific secrets, API keys, or model credentials.

## Workflows

- Workflow metadata lives at `configs/app_config.yaml` under `workflow_defaults.workflow_metadata`.
- Selectable workflow IDs are the metadata keys: `t2i`, `i2i`, `nano_banana_pro`, `gpt_image`, `flf2v`, `kling_flf2v`, and `i2v`.
- `t2i`: ComfyUI Z-Image text-to-image.
- `i2i`: ComfyUI Q-Image editing with up to three references and original-size support.
- `nano_banana_pro`: Gemini image generation/editing with optional multi-image context.
- `gpt_image`: OpenAI-compatible image generation/editing with optional multi-image input.
- `flf2v`: ComfyUI Wan first/last-frame video with loop and frame controls.
- `kling_flf2v`: Kling first/last-frame video.
- `i2v`: ComfyUI Wan image-to-video with frame count and frame rate controls.
- `workflow_files` also contains internal `image_upscale` and `image_upscale_invsr` workflows. They are utility workflows, not selectable generation modes.
- Current JSON files are `t2i_workflow_api.json`, `qwen_image_edit_workflow_api.json`, `flf2v_workflow_api.json`, `i2v_workflow_api.json`, `image_upscale_workflow_api.json`, and `image_upscale_invsr_workflow_api.json`.
- Common metadata fields include `label`, `description`, `category`, `method`, input capability flags, `output_type`, `prompt_template`, and `parameters`.

## Adding A Workflow

- For a ComfyUI generation workflow, add the exported API JSON, register `workflow_files`, add `workflow_metadata`, and verify whether generic service dispatch supports its inputs and outputs.
- For an external API workflow, add environment-backed configuration, an API client, explicit `AIDrawService` dispatch, metadata, backend schemas, and frontend request types. Do not add a dummy ComfyUI JSON.
- For an internal utility workflow, add only the `workflow_files` mapping and consuming backend logic unless it should be selectable by users.
- Workflow discovery is dynamic, but behavior is not fully metadata-driven. Search for hardcoded IDs in `server/ai_draw_service.py`, `frontend/src/stores/appStore.ts`, `ChatInput.tsx`, and `SettingsModal.tsx`.
- `send_history` exists in generation schemas but backend history behavior is currently controlled primarily by whether a chat `session_id` is sent. Verify behavior before changing Gemini history logic.

## Frontend Architecture

- `frontend/src/main.tsx`: React entry point and `ErrorBoundary` installation.
- `frontend/src/App.tsx`: authenticated application shell and WebSocket result handling.
- `frontend/src/stores/appStore.ts`: primary Zustand state and most current store types.
- `frontend/src/api/client.ts`: Axios setup, JWT injection, and mixed error-envelope handling.
- `frontend/src/api/services.ts`: REST methods for auth, sessions, generation, media utilities, and persistence.
- `frontend/src/api/websocket.ts`: authenticated WebSocket connection, browser connection ID, and reconnect handling.
- `frontend/src/types/api.ts` and `frontend/src/types/models.ts`: API and persisted model types.
- `frontend/src/types/store.ts` is older; verify active imports before extending it.
- `frontend/src/components/FrameExtractionModal.tsx`: frame extraction, workset selection, edits, background processing, upscaling, and export flow.
- `frontend/src/components/ResultGrid.tsx`: generated media display and entry points to media tools.
- `frontend/src/components/BackgroundOptionsFields.tsx`: shared background-removal controls.
- `frontend/src/utils/frameColorReplacement.ts` and `imageUpscale.ts`: client-side frame/color and upscale helpers.
- Preserve the existing Ant Design and product-specific interaction patterns unless the task explicitly requests a redesign.
- The current Vite development proxy targets `localhost:8000`, while `.env.example` defaults `SERVER_PORT` to `14600`. Align one side before local integrated testing.

## WebSocket Behavior

- `server/websocket/__init__.py` contains the global `ConnectionManager`.
- Connections require `/ws?token=<JWT>`; unauthenticated connections close with code `1008`.
- After connecting, the frontend sends an `init` message with a browser connection ID from local storage. This is not a database chat-session ID.
- Service callbacks call `manager.broadcast()` without a session ID, so state currently reaches every authenticated connection.
- State messages use `{"type":"state_change","field":"is_generating","value":true}`.
- Generation errors use `{"type":"state_change","field":"error","value":"..."}`, not a top-level WebSocket `error` message.
- Useful log markers include `[WebSocket] 客户端已连接` and `[WebSocket] 会话ID已设置`.

## ComfyUI And API Integrations

- `comfyui/comfyui_service.py`: workflow loading, parameter injection, queueing, and output collection.
- `comfyui/requests/comfyui_request_interface.py`: request abstraction.
- `comfyui/requests/local_comfyui_request.py`: active HTTP ComfyUI implementation.
- Preserve existing UTF-8/GBK compatibility when touching temporary workflow files.
- In remote Docker, `COMFYUI_HOST=comfyui` works only if that hostname is reachable from `ai-draw-network`; this Compose file does not create a ComfyUI service.
- `utils/gemini_chat.py`: Gemini/Nano Banana image generation and conversation context.
- `utils/openai_image.py`: OpenAI-compatible image generation/editing.
- `utils/kling_video.py`: Kling generation, polling, and download.
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
- `uploads/` is shared with Nginx and exposed under `/uploads` without per-request authorization.
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
- Generation behavior: edit `server/ai_draw_service.py`, preserve `is_generating`, preview/result, error, and cancellation state notifications, and account for the global singleton task model.
- Database model: edit `server/models.py`, define how existing deployed databases migrate, and do not assume `create_all()` changes existing tables.
- Workflow UI: update metadata first, then audit hardcoded workflow-specific branches and persisted session configuration.
- WebSocket: inspect browser Network/WS frames and backend connection logs; verify authentication and cross-client behavior.
- Frame processing: keep backend request models, frontend staged state, undo/redo, progress polling, and export cleanup consistent.

## Key Files

- `.env.example`: complete environment variable manifest.
- `.vscode/tasks.json`: remote deploy, status, logs, and restart tasks.
- `Dockerfile`: Node/Python multi-stage application image.
- `docker-compose.yml`: remote FastAPI/PostgreSQL/Nginx composition and persistent volumes.
- `nginx/nginx.conf.template`: HTTP routing, uploads, API, and WebSocket proxy behavior.
- `configs/app_config.yaml`: workflow mappings, metadata, and defaults.
- `configs/workflows/`: ComfyUI API JSON files.
- `server/main.py`: app lifecycle and router mounting.
- `server/ai_draw_service.py`: core generation orchestration.
- `server/api/`: REST routers.
- `server/models.py`: ORM models.
- `server/database.py`: engine, sessions, startup table creation, and idempotent DDL.
- `server/auth.py`: JWT authentication.
- `server/websocket/__init__.py`: WebSocket connections and broadcasts.
- `utils/config_loader.py`: environment-backed configuration.
- `frontend/package.json`: frontend scripts and dependency versions.
- `frontend/vite.config.ts`: dev server and proxy ports.
- `frontend/src/App.tsx`: application shell.
- `frontend/src/stores/appStore.ts`: primary frontend state.
- `frontend/src/api/`: frontend REST and WebSocket clients.
- `frontend/src/components/`: chat, result, settings, and media-workbench UI.
- `tests/` and `frontend/tests/`: current unit tests.
