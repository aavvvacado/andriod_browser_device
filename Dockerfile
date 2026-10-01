FROM node:20-bookworm-slim

# Install Android Debug Bridge (ADB), FFmpeg for MP4 transwrapping, and CA certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    adb \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy scrcpy-server.jar
COPY scrcpy-server.jar /app/scrcpy-server.jar

# Install backend dependencies and build TypeScript server
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci

COPY backend/ ./
RUN npm run build

# Ensure recordings directory exists
RUN mkdir -p /app/backend/recordings

ENV PORT=3000
ENV ADB_HOST=127.0.0.1
ENV ADB_PORT=5037
ENV SCRCPY_SERVER_PATH=/app/scrcpy-server.jar

EXPOSE 3000

CMD ["node", "dist/index.js"]
