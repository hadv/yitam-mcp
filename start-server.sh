#!/bin/zsh

# Exit on error
set -e

# Function to check if command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Load nvm (trying multiple common locations)
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  echo "Loading nvm from $HOME/.nvm..."
  . "$HOME/.nvm/nvm.sh" --no-use
elif [ -s "/usr/local/opt/nvm/nvm.sh" ]; then
  echo "Loading nvm from /usr/local/opt/nvm..."
  . "/usr/local/opt/nvm/nvm.sh" --no-use
elif command_exists brew && [ -s "$(brew --prefix nvm)/nvm.sh" ]; then
  echo "Loading nvm from brew installation..."
  . "$(brew --prefix nvm)/nvm.sh" --no-use
else
  echo "Could not find nvm installation. Please make sure nvm is installed properly."
  exit 1
fi

# Use LTS version of Node.js
echo "Setting up Node.js version..."
nvm use 22.14.0

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