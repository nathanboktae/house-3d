FROM node:22-alpine AS assets
RUN apk add --no-cache python3
WORKDIR /src
COPY matterport-house/scripts/package.json matterport-house/scripts/pnpm-lock.yaml ./matterport-house/scripts/
RUN npm install --ignore-scripts --prefix matterport-house/scripts
COPY website/build.py ./website/
COPY website/public ./website/public
COPY matterport-house/output/house-clean.glb ./matterport-house/output/house-clean.glb
RUN python3 website/build.py

FROM python:3.13-alpine
WORKDIR /app
COPY addon/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && adduser -D -u 1000 viewer
COPY --from=assets /src/website/dist ./static
COPY addon/server.py ./server.py
# Startup reads Supervisor options as root, then drops to viewer before serving.
EXPOSE 8099
CMD ["python", "server.py"]
