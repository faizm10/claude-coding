# Sandbox image for Ghost Engineer jobs: language toolchains + both agent CLIs.
FROM node:22-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
      git python3 python3-pip python3-venv golang-go ripgrep ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3 /usr/local/bin/python

RUN npm install -g @anthropic-ai/claude-code @openai/codex

# uv provisions per-task Python versions and venvs (SWE-bench tasks).
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

# Run as an unprivileged user; the repo is mounted at /work.
RUN useradd -m ghost && mkdir -p /work && chown ghost /work
USER ghost
WORKDIR /work

# Auth (pass with `docker run -e`):
#   Claude Code: CLAUDE_CODE_OAUTH_TOKEN  (create with `claude setup-token`)
#   Codex:       mount ~/.codex/auth.json read-only into /home/ghost/.codex/
