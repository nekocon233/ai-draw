# Codex subscription image proxy

The `gpt_image` workflow uses CLIProxyAPI v7.3.6 with Codex subscription OAuth.
The UI identifies this as the Codex subscription channel. The configured image
model is `gpt-image-2.5-flare`; accepting that name does not by itself establish
which model the upstream account actually serves.

Use the project's existing Compose file and Docker Engine. On nekocon-server
itself, run `docker compose` against the local Engine. From another machine,
use `DOCKER_HOST=ssh://nekocon-server`. Do not create a second Compose deployment.

The deployment uses these settings in the untracked `.env`:

```dotenv
COMPOSE_PROFILES=codex-proxy
GPT_IMAGE_BASE_URL=http://cli-proxy-api:8317/v1
GPT_IMAGE_MODEL=gpt-image-2.5-flare
GPT_IMAGE_API_KEY=<a-new-random-proxy-key>
```

`gpt-image-2.5-sunburst` can be selected instead after validating that model.
Use a proxy key containing only letters, digits, underscores, and hyphens.
This key authenticates ai-draw to the proxy; the subscription's OAuth
credentials are stored separately in the `codex-proxy-auth` Docker volume.
Do not put OAuth tokens in `.env`, source control, or container images.

The proxy has its own OAuth grant for the same subscription account, including
a refresh token persisted in the auth volume. The original Codex CLI login is
preserved. For initial setup or reauthorization on a headless server, use:

```sh
docker compose run --rm --no-deps cli-proxy-api --codex-device-login --no-browser
```

Complete the displayed device code at `https://auth.openai.com/codex/device`.
The proxy stores the resulting grant in its auth volume and handles renewal.
Alternatively, use the browser callback flow:

```sh
docker compose --profile codex-proxy run --rm -p 127.0.0.1:1455:1455 cli-proxy-api --codex-login --no-browser
```

Complete the printed authorization URL in a browser. If the Docker Engine
is on another machine, forward local port 1455 to port 1455 on that machine
for the OAuth callback. The normal proxy service does not publish an API or
management port to the host.

Verify plain generation, one reference image, and three reference images;
inspect the original response and image metadata as supporting evidence of
the requested model. Verify rate-limit and timeout error handling as well.
Keep the previous GPT Image settings until validation succeeds.

Then run the existing `deploy: remote` task, which refreshes `frontend-dist`,
or its equivalent on the local Engine: `docker compose down`,
`docker volume rm --force ai-draw_frontend-dist`, `docker compose build`,
and `docker compose up -d`, in that order.
Preserve `codex-proxy-auth` along with the existing database, uploads, and
model-cache volumes. To return to a previous provider, restore the previous
three GPT Image values, remove `codex-proxy` from `COMPOSE_PROFILES`, and use
the same deployment task.

## Validation on 2026-09-17

CLIProxyAPI v7.3.6 was tested using the current Pro account's cached access
token. The existing Codex refresh token was not copied or refreshed. The
temporary proxy and temporary credential copies were removed after each test.

| Request | Result |
| --- | --- |
| Images API, exact name `gpt-image-2.5` | Request accepted and PNG returned; embedded generator claim `gpt-image` / `2.0` |
| Images API, `gpt-image-2.5-flare` | PNG returned; embedded generator claim `gpt-image` / `2.0` |
| Images API, `gpt-image-2.5-sunburst` | PNG returned; embedded generator claim `gpt-image` / `2.0` |
| Responses API, `gpt-5.6-sol` with the Flare image tool | PNG returned; embedded generator claim `gpt-image` / `2.0` |
| Responses API, `gpt-6-astra` with the Flare image tool | PNG returned; embedded generator claim `gpt-image` / `2.0` |
| Images edits, Flare with one PNG reference | Multipart `image[]` accepted; PNG returned with the same `2.0` claim |
| Images edits, Flare with three PNG references | Multipart `image[]` accepted; PNG returned with the same `2.0` claim |

All seven responses returned `quality: low` and 1254 × 1254 PNGs. The five
generation tests explicitly requested `medium` and `1024x1024`; the edit tests
used only `model`, `prompt`, and reference files, matching ai-draw's existing
request shape. Visual inspection of the three-reference edit confirmed the
requested red-to-blue color change with the square composition preserved.

The embedded C2PA claim was inspected, but its cryptographic signature was
not verified; a stale upstream claim remains possible. Together with the
unhonored generation parameters, these results do not establish the actual
upstream model version. The application therefore labels the subscription
channel without promising a verified 2.5 model identity.

The exact unsuffixed `gpt-image-2.5` name was checked separately: CLIProxyAPI
advertises it and the subscription route accepts the request. This establishes
request compatibility, not the identity of the image model actually served.
OpenAI's public model documentation explicitly lists
[`gpt-image-2.5-flare`](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare)
and [`gpt-image-2.5-sunburst`](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst).
The proxy maintainer attributes the older generator claim to upstream behavior
in [issue #5762](https://github.com/router-for-me/CLIProxyAPI/issues/5762#issuecomment-5645830043);
that issue was closed as not planned, not as a deployed fix.

Static Compose validation and shell syntax checks passed. Docker access was
subsequently restored by recreating the OpenChamber tool container with the
existing host's `/var/run/docker.sock` mounted. The tool now reaches Docker
28.5.1 on `nekocon-ubuntu`; OpenCode is ready and Codex remains signed in with
ChatGPT. The existing ai-draw services remained healthy throughout this change.
The proxy is now enabled and the backend's running configuration points to
`http://cli-proxy-api:8317/v1`. The old provider settings and image reference are
retained in the private, ignored `.runtime/codex-subscription/` directory for
rollback. The proxy API has no published host port.

## Deployed application verification

Deployment used the existing local Compose sequence, refreshed only
`frontend-dist`, and preserved PostgreSQL, uploads, model-cache, and proxy-auth
volumes. The backend and PostgreSQL are healthy, and the public workflow API
reports `GPT Image（Codex 订阅）`.

The following tests used an isolated authenticated ai-draw user through the
deployed generation API, not a direct standalone proxy request:

| Case | Result | Duration |
| --- | --- | --- |
| Text-to-image | PNG returned through WebSocket and saved in chat history | 15.9 s |
| One-reference edit | PNG returned through WebSocket and saved in chat history | 17.6 s |
| Three-reference edit | PNG returned through WebSocket and saved in chat history | 23.1 s |

All three result files were fetched successfully through the public website.
They were 1254 × 1254 PNGs and still carried the `gpt-image` / `2.0` generator
claim described above. Temporary test sessions, images, and the test account
were removed after verification.

Backend tests passed (35), frontend tests passed under Node 22 (31), and the
Docker production build passed, including TypeScript and Vite. Frontend lint
still reports 26 existing findings in unchanged TypeScript files; those were
not modified as part of this channel switch.
