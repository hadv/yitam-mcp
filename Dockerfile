# Build stage
FROM node:20-alpine as build

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Copy .env if it exists (will not fail if file doesn't exist)
COPY .env* ./dist/ 2>/dev/null || true

# Production stage - we only need the dist files
FROM node:20-alpine

WORKDIR /app

# Copy only the built files from build stage
COPY --from=build /app/dist ./dist