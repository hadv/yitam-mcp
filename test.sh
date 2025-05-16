#!/bin/bash

# Ensure we're using the right Node.js version
. ~/.nvm/nvm.sh
nvm use --lts

# Kill any existing Node processes
killall -9 node 2>/dev/null || true
echo "Killed any existing Node processes"
sleep 1

# Decision: test with mock server or actual implementation
if [ "$1" == "mock" ]; then
  echo "Starting mock test server..."
  PORT=8080 node test-server.js &
  SERVER_PID=$!
  echo "Mock server started with PID: $SERVER_PID"
else
  echo "Starting actual HTTP server implementation..."
  npm run start:http &
  SERVER_PID=$!
  echo "HTTP server started with PID: $SERVER_PID"
fi

# Give the server time to start
sleep 2

# Run the test client
echo "Running test client..."
node test-client.js

# Cleanup
echo "Cleaning up..."
kill $SERVER_PID
echo "Server with PID $SERVER_PID terminated"

echo "Test completed!" 