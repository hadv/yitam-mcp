# Build stage - use a more complete Node image instead of alpine
FROM node:20 as build

WORKDIR /app

# Install build essentials
# Install build essentials and debugging tools
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    make \
    g++ \
    curl \
    procps

# Copy package files
COPY package*.json ./

# Try different install approaches with detailed logging
RUN node -v && \
    echo "Attempting npm install with detailed logs..." && \
    npm install --verbose || \
    (echo "Standard install failed, trying with ignore-scripts..." && \
    npm install --ignore-scripts --verbose)

# Copy source code
COPY . .

# Build with proper error output
RUN echo "Starting build process..." && \
    npm run build || \
    (echo "Build failed. Check logs:" && \
    cat $(find /root/.npm/_logs -type f -name "*-debug-0.log" | sort -r | head -n1) && \
    exit 1)

# Production stage - can use alpine for smaller final image
FROM node:20-alpine

WORKDIR /app

# Copy only the built files and package.json for runtime dependencies
COPY --from=build /app/dist ./dist