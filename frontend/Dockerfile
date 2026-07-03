# ── Stage 1: Build the React app ─────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

# Install deps first (separate layer for caching)
COPY frontend/package*.json ./
RUN npm ci

# Build
COPY frontend/ .
RUN npm run build

# ── Stage 2: Serve with nginx (no Node.js in final image) ────────────────────
FROM nginx:alpine AS serve
COPY --from=build /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
