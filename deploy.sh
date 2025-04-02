#!/bin/bash

# Exit on error
set -e

# Load environment variables if .env file exists
if [ -f .env ]; then
    echo "Loading environment variables from .env file..."
    export $(cat .env | grep -v '^#' | xargs)
else
    echo "No .env file found. Please create one based on .env.example"
    exit 1
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "Docker is not running. Please start Docker first."
    exit 1
fi

# Build the Docker image
echo "Building Docker image..."
docker build -t yitam-mcp:production .

# Stop existing container if it exists
if docker ps -a | grep -q yitam-mcp; then
    echo "Stopping existing container..."
    docker stop yitam-mcp || true
    docker rm yitam-mcp || true
fi

# Run the container
echo "Starting container..."
docker run -d \
    --name yitam-mcp \
    --restart unless-stopped \
    -p "${PORT:-3000}:3000" \
    --env-file .env \
    yitam-mcp:production

# Wait for health check
echo "Waiting for application to start..."
for i in {1..30}; do
    if docker ps | grep -q "yitam-mcp"; then
        if docker inspect yitam-mcp | grep -q '"Status": "healthy"'; then
            echo "Application is running and healthy!"
            exit 0
        fi
    fi
    echo "Waiting for container to be healthy... ($i/30)"
    sleep 2
done

echo "Container did not become healthy within 60 seconds. Please check logs:"
docker logs yitam-mcp
exit 1 