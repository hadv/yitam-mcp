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

# Production stage - we only need the dist files
FROM node:20-alpine

WORKDIR /app

# Copy only the built files from build stage
COPY --from=build /app/dist ./dist