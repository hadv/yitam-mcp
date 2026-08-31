#!/bin/bash

# Kill any existing Node processes
killall -9 node 2>/dev/null || true
echo "Killed any existing Node processes"
sleep 1

# Make sure we have the latest build
echo "Building the project..."
npm run build || { echo "Build failed!"; exit 1; }
echo "Build successful!"

# Decision: test with mock server or actual implementation
if [ "$1" == "mock" ]; then
  echo "Starting mock test server..."
  PORT=8080 node test-server.js > server.log 2>&1 &
  SERVER_PID=$!
  echo "Mock server started with PID: $SERVER_PID"
else
  echo "Starting custom MCP server implementation..."
  node test-mcp-server.js > server.log 2>&1 &
  SERVER_PID=$!
  echo "MCP server started with PID: $SERVER_PID"
fi

# Give the server time to start
echo "Waiting for server to start..."
sleep 5

# Check if the server is actually running
if ! ps -p $SERVER_PID > /dev/null; then
  echo "ERROR: Server failed to start! Check server.log for details:"
  cat server.log
  exit 1
fi

# Check if server is listening on the expected port
if ! lsof -i :8080 > /dev/null 2>&1; then
  echo "ERROR: Server is not listening on port 8080! Check server.log for details:"
  cat server.log
  echo "Terminating server process..."
  kill $SERVER_PID 2>/dev/null || true
  exit 1
fi

# Run the test client
echo "Running test client..."
node test-client.js

# Cleanup
echo "Cleaning up..."
kill $SERVER_PID 2>/dev/null || true
echo "Server with PID $SERVER_PID terminated"

echo "Test completed!" 