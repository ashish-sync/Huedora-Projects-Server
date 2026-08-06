# TYLO One API — includes LibreOffice for Word-faithful Document Template PDFs
FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    DEBIAN_FRONTEND=noninteractive \
    SAL_DISABLE_OPENCL=1 \
    SAL_NOOPENGL=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libreoffice-writer \
    fonts-liberation \
    fonts-dejavu-core \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && (command -v soffice >/dev/null || command -v libreoffice >/dev/null)

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build:parsers && npm prune --omit=dev

# Render sets PORT; default for local docker runs
ENV PORT=10000
EXPOSE 10000

CMD ["node", "--max-old-space-size=384", "src/index.js"]
