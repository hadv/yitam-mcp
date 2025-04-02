#!/bin/bash

# Exit on error
set -e

# Use LTS version of Node.js
echo "Setting up Node.js LTS version..."
nvm use --lts

# Load environment variables if .env file exists
if [ -f .env ]; then
    echo "Loading environment variables from .env file..."
    set -a
    source .env
    set +a
else
    echo "No .env file found. Creating from .env.example..."
    cp .env.example .env
    echo "Please configure your .env file before running the server again."
    exit 1
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Run the server using npx
echo "Starting the server..."
npx ts-node -r tsconfig-paths/register -r dotenv/config ./src/core/server/yitam-tools.ts 