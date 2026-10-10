# Web image: static UI + reverse proxy on :8080 (UI and /api/* share one viewer origin).
# Build from the repository root:  docker build -f frontend/Dockerfile -t sevaro-web:dev .
FROM node:20.18.1-alpine AS build
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27.3-alpine
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8080/nginx-health || exit 1
