# AGENTS.md

## Project Conventions

- Treat Docker as the source of truth for deployable builds.
- `docker-compose.yml` is the SSH remote deployment compose file; VS Code tasks set `DOCKER_HOST=ssh://nekocon-server`.
- Do not add or restore local Docker Compose deployment workflows. This project is not deployed with local Docker.
- `docker compose build` only rebuilds images; it does not restart running services or refresh the `frontend-dist` named volume that Nginx serves.
- After finishing code changes and local verification, always run the VS Code task `deploy: remote` before reporting completion; do not wait for the user to deploy manually.
- To run the same deployment sequence directly, use `$env:DOCKER_HOST="ssh://nekocon-server"; docker compose down; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; docker volume rm --force ai-draw_frontend-dist; docker compose build; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; docker compose up -d`.
- Local commands such as `npm run build`, `npm run lint`, or Python syntax checks can be used for quick feedback, but they are not the final project build path.
- Manual testing is normally done against `https://aidraw.nekocon.cn/`.

## Project Overview

- AI-Draw is a FastAPI + React AI drawing web app.
- The backend integrates ComfyUI workflows for image/video generation.
- The app also supports API-based generation paths such as Gemini/Nano Banana, GPT Image, and Kling video generation.
- The architecture is frontend/backend separated, with WebSocket state updates for long-running generation tasks.
- Authentication uses JWT, and persisted user/session data is stored in PostgreSQL.

## Tech Stack

- Backend: FastAPI, SQLAlchemy 2.0, PostgreSQL 15, JWT via `python-jose`, Pydantic v2, `pydantic-settings`, WebSocket support.
- AI integrations: ComfyUI, OpenAI-compatible APIs, Google Gemini via `google-genai`, PixelLab, Kling video API.
- Media processing: Pillow, OpenCV headless, rembg, transparent-background, PyTorch, ffmpeg-backed helpers.
- Frontend: React 19, TypeScript 5.9, Zustand 5, Ant Design 6, Vite 7, Axios.

## Backend Architecture

- `server/api/media.py`: media generation API for image/video generation, route prefix `/media`.
- `server/api/prompt.py`: prompt generation, pose presets, and image analysis endpoints.
- `server/api/service.py`: service status and workflow configuration endpoints.
- `server/api/user.py`: authentication and user config endpoints.
- `server/api/session.py`: chat session and history endpoints.
- `server/api/__init__.py`: registers all API routers.
- `server/schemas.py`: Pydantic request/response models, including media generation models.
- `server/ai_draw_service.py`: core `AIDrawService`, orchestration for ComfyUI/API generation, state changes, and WebSocket notifications.
- Use `get_ai_draw_service()` with FastAPI `Depends` to access the singleton service in API handlers.
- Long-running generation should return quickly and run in `BackgroundTasks` or the existing async/thread helpers, with results pushed through WebSocket/state updates.

## Data Model

- `User`: user account data.
- `UserConfig`: per-user generation defaults and UI config.
- `ChatSession`: conversation metadata and saved generation config.
- `ChatMessage`: chat/generation messages and generation parameters.
- `GeneratedImage`: generated media records associated with messages.
- `ReferenceImage`: uploaded reference images.
- Video and multi-reference fields exist on sessions/messages, including start/end frame prompt/image config, loop settings, frame counts, frame rate, and up to 3 reference images for supported workflows.

## Configuration

- Environment variables are the source of truth for service ports, secrets, database, Redis, and external API credentials.
- `.env` is loaded by Docker Compose and the app config layer.
- `docker-compose.yml` defines the remote SSH Docker service composition.
- `configs/app_config.yaml` should only hold complex workflow metadata and workflow defaults.
- `utils/config_loader.py` uses Pydantic Settings with environment-variable aliases.
- Important config classes include `AppConfig`, `NanoBananaConfig`, `RedisConfig`, and the global `Config` aggregate.

## Workflows

- Workflow JSON files live in `configs/workflows/*.json`.
- Workflow metadata lives in `configs/app_config.yaml` under `workflow_defaults.workflow_metadata`.
- Current ComfyUI workflow files include `t2i_workflow_api.json`, `qwen_image_edit_workflow_api.json`, `flf2v_workflow_api.json`, and `i2v_workflow_api.json`.
- Current workflow IDs include `t2i`, `i2i`, `nano_banana_pro`, `gpt_image`, `flf2v`, `kling_flf2v`, and `i2v`.
- `t2i`: text to image, Z-Image, no reference image required.
- `i2i`: image to image, Q-Image, supports multiple reference images and original-size mode.
- `nano_banana_pro`: Gemini/Nano Banana Pro image workflow, supports optional multi-image context.
- `gpt_image`: OpenAI-compatible GPT Image workflow, supports optional multi-image input.
- `flf2v`: Wan first/last-frame video workflow, requires start and end images.
- `kling_flf2v`: Kling first/last-frame video workflow, requires start and end images.
- `i2v`: Wan image-to-video workflow, requires one reference image and supports frame count/frame rate parameters.
- Common metadata fields include `label`, `description`, `category`, `method`, `requires_image`, `supports_multi_image`, `supports_original_size`, `requires_end_image`, `supports_loop`, `output_type`, `prompt_template`, and `parameters`.
- To add a workflow: export the ComfyUI API JSON into `configs/workflows/`, add it to `workflow_files` when applicable, add metadata in `workflow_metadata`, then ensure the frontend uses `/api/service/workflows` rather than hardcoded workflow assumptions.

## Frontend Architecture

- `frontend/src/App.tsx`: React application entry.
- `frontend/src/stores/appStore.ts`: Zustand app state. Most current store types are inline in this file.
- `frontend/src/api/client.ts`: Axios client setup and JWT handling.
- `frontend/src/api/services.ts`: REST API methods for auth, sessions, config, generation, and message operations.
- `frontend/src/api/websocket.ts`: WebSocket manager with reconnect handling.
- `frontend/src/types/api.ts`: API request/response types and workflow metadata types.
- `frontend/src/types/models.ts`: data model types.
- `frontend/src/types/store.ts`: older store type file; verify current usage before extending it.
- Follow the existing Ant Design and app-specific layout patterns unless explicitly redesigning UI.

## WebSocket Behavior

- `server/websocket/__init__.py` contains the global `ConnectionManager`.
- Connections may be associated with session IDs.
- Service state changes are pushed through the service `on_state_change` callback.
- State messages use the shape `{"type": "state_change", "field": "is_generating", "value": true}`.
- Error messages use the shape `{"type": "error", "message": "..."}`.
- Useful backend log marker: `[WebSocket] 客户端已连接，会话ID: xxx，当前连接数: 1`.

## ComfyUI Integration

- `comfyui/comfyui_service.py` wraps ComfyUI workflow execution.
- `comfyui/requests/` abstracts local/cloud ComfyUI request implementations via `comfyui_request_interface.py`.
- `comfyui/structures/` contains supporting data structures.
- Temporary workflow files should keep the existing utf-8/gbk compatibility behavior.
- In remote Docker, default `COMFYUI_HOST=comfyui`; if ComfyUI is not in the same Docker network, use a hostname or IP reachable from the remote server containers.

## API-Based Generation

- `utils/gemini_chat.py` handles Gemini/Nano Banana multi-turn image generation.
- `utils/openai_image.py` handles OpenAI-compatible image generation/editing.
- `utils/kling_video.py` handles Kling video generation and downloads.
- `utils/pixel_lab.py` handles PixelLab integration.
- API credentials and model names must come from config/environment variables, not hardcoded values.
- For `nano_banana_pro`, no-reference requests may route to Gemini single-turn or multi-turn generation depending on history settings; reference-image requests may route through image-capable generation logic.
- `POST /prompt/analyze-image` reuses image-capable model logic to analyze a reference image and produce a Z-Image-style prompt.

## Media Processing And Storage

- `utils/media_processor.py` provides image/video resize helpers, including ffmpeg-backed video processing.
- `utils/video_frames.py` contains video frame extraction/background-removal helpers.
- `utils/thread_runner.py` provides a singleton event-loop thread runner for async work that should not block the main FastAPI loop.
- `utils/file_storage.py` manages uploaded files and generated media paths.
- Logged-in users store uploaded/generated media under `uploads/` and persist generated result records in the database.
- Guest mode media may be stored client-side by the frontend.

## Auth And Errors

- `server/auth.py` provides `get_current_user` for required auth and `get_optional_user` for guest-compatible routes.
- Use existing auth dependencies instead of manually parsing JWTs in route handlers.
- `server/middleware/error_handler.py` centralizes backend exception handling.
- Frontend rendering errors are handled by the existing `ErrorBoundary` component.

## Common Change Guides

- Adding an API endpoint: add the route in the relevant `server/api/` module, define schemas in `server/schemas.py`, inject services with `Depends(get_ai_draw_service)`, use auth dependencies when needed, register a new router in `server/api/__init__.py` if you create a new module, then update frontend services/types.
- Modifying database models: edit `server/models.py`; app startup currently uses SQLAlchemy table creation, but real field migrations should use Alembic if data migration is required.
- Modifying service logic: prefer editing `server/ai_draw_service.py` and keep WebSocket state notifications intact, especially around `is_generating` and error paths.
- Modifying workflow UI: update `configs/app_config.yaml` metadata first, then make frontend behavior consume `/api/service/workflows` rather than duplicating workflow metadata.
- Debugging WebSocket: inspect browser DevTools Network WS frames and backend WebSocket connection logs.

## Key Files

- `Dockerfile`: backend/frontend build image.
- `docker-compose.yml`: SSH remote Docker deployment composition.
- `nginx/Dockerfile`: Nginx image used for remote deployment.
- `nginx/docker-entrypoint.sh`: Nginx startup/config generation behavior.
- `.env`: environment variables and secrets; do not commit real secrets.
- `configs/app_config.yaml`: workflow metadata and defaults.
- `configs/workflows/`: ComfyUI workflow API JSON files.
- `server/main.py`: FastAPI app entry and lifecycle setup.
- `server/ai_draw_service.py`: core generation orchestration.
- `server/api/`: REST API routers.
- `server/models.py`: SQLAlchemy ORM models.
- `server/database.py`: database engine/session management.
- `server/auth.py`: JWT authentication.
- `server/websocket/__init__.py`: WebSocket connection management.
- `utils/config_loader.py`: environment-driven config loading.
- `utils/ai_prompt.py`: AI prompt expansion through OpenAI-compatible APIs.
- `utils/gemini_chat.py`: Gemini/Nano Banana image generation.
- `utils/openai_image.py`: GPT Image/OpenAI-compatible image APIs.
- `utils/kling_video.py`: Kling video APIs.
- `utils/media_processor.py`: media resize/transcode utilities.
- `utils/thread_runner.py`: background event-loop runner.
- `frontend/src/App.tsx`: React application shell.
- `frontend/src/stores/appStore.ts`: Zustand state store.
- `frontend/src/api/`: frontend API and WebSocket clients.
- `frontend/src/components/`: UI components.
- `frontend/src/types/`: frontend TypeScript types.
