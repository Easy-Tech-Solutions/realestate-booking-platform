FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json && npm prune --omit=dev
# node-llama-cpp ships prebuilt llama.cpp binaries for every platform/GPU flavour as
# optional dependencies; inference here is CPU-only, so keep just this CPU arch's build
# (drops ~600 MB of CUDA/Vulkan/other-arch binaries) and no llama.cpp source bundle
# (only used to compile from source, which the runtime never does: build: 'never').
RUN rm -f node_modules/node-llama-cpp/llama/gitRelease.bundle \
 && cd node_modules/@node-llama-cpp \
 && rm -rf ./*-cuda* ./*-vulkan* \
 && case "$(uname -m)" in \
      x86_64) rm -rf linux-arm64 linux-armv7l ;; \
      aarch64) rm -rf linux-x64 linux-armv7l ;; \
    esac

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    CHROMIUM_PATH=/usr/bin/chromium-headless-shell
# Headless Chromium (Debian's chromium-headless-shell: the print/screenshot-only build,
# no GTK) renders the lease / owner-agreement PDFs (src/lib/pdf.ts) — the WeasyPrint
# equivalent. fonts-liberation: the same serif family the Django image ships for
# WeasyPrint (Liberation Serif = "Times New Roman" metrics).
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium-headless-shell fonts-liberation fontconfig && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node parity/django-routes.json ./parity/django-routes.json
COPY --chown=node:node templates ./templates
# ai_models: the GGUF model volume of express-worker-ai (download_ai_model.js writes it as 'node').
RUN mkdir -p /app/media /app/ai_models && chown node:node /app /app/media /app/ai_models
USER node
EXPOSE 8000
CMD ["node", "dist/server.js"]
