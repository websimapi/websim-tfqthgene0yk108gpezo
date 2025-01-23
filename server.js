const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let llamaProcess = null;
let llamaStatus = 'Not Initialized';

function checkLlamaFile() {
  const llamaPath = path.join(__dirname, 'llava-v1.5-7b-q4.llamafile');
  return fs.existsSync(llamaPath);
}

function startLlama() {
  const llamaPath = path.join(__dirname, 'llava-v1.5-7b-q4.llamafile');
  
  // First check if file exists
  if (!checkLlamaFile()) {
    console.log('LLaMA file not found. User needs to download it.');
    llamaStatus = 'Not Found';
    broadcastToAll({ 
      type: 'llamaStatus', 
      status: llamaStatus 
    });
    broadcastToAll({ 
      type: 'needsDownload'
    });
    return;
  }

  // Set executable permissions on Unix-like systems
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(llamaPath, '755');
    } catch (error) {
      console.error('Error setting executable permissions:', error);
    }
  }

  // On Windows, we need to add .exe extension
  const executablePath = process.platform === 'win32' 
    ? `${llamaPath}.exe` 
    : llamaPath;

  // Use spawn instead of exec for better process control and output streaming
  llamaProcess = spawn(executablePath, ['--server', '--host', '127.0.0.1', '--port', '8080'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  llamaProcess.stdout.on('data', (data) => {
    const output = data.toString();
    console.log('LLaMA output:', output);
    if (output.includes('server listening')) {
      llamaStatus = 'Ready';
      broadcastToAll({ type: 'llamaStatus', status: llamaStatus });
    }
  });

  llamaProcess.stderr.on('data', (data) => {
    console.error('LLaMA error:', data.toString());
  });

  llamaProcess.on('error', (error) => {
    console.error('Failed to start LLaMA process:', error);
    llamaStatus = 'Error';
    broadcastToAll({ type: 'llamaStatus', status: llamaStatus });
  });

  llamaProcess.on('exit', (code, signal) => {
    console.log(`LLaMA process exited with code ${code} and signal ${signal}`);
    llamaStatus = 'Stopped';
    broadcastToAll({ type: 'llamaStatus', status: llamaStatus });
    llamaProcess = null;
  });
}

function broadcastToAll(message) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

wss.on('connection', (ws) => {
  console.log('New WebSocket connection');
  ws.send(JSON.stringify({ type: 'llamaStatus', status: llamaStatus }));
  
  ws.on('message', async (message) => {
    const data = JSON.parse(message);
    
    if (data.type === 'prompt') {
      try {
        const response = await fetch('http://localhost:8080/completion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: data.prompt,
            temperature: 0.7,
            max_tokens: 500
          })
        });
        
        if (!response.ok) {
          throw new Error('Failed to get response from LLaMA');
        }

        const result = await response.json();
        ws.send(JSON.stringify({
          type: 'llamaResponse',
          response: result.content
        }));
      } catch (error) {
        console.error('Error processing prompt:', error);
        ws.send(JSON.stringify({
          type: 'llamaResponse',
          response: 'Error processing prompt: ' + error.message
        }));
      }
    }
  });
});

// Initialize server
console.log('Starting server...');
startLlama();

app.get('/', (req, res) => {
  res.send('Node.js WebSocket Server Running with LLaMA Integration');
});

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

// Handle process termination
function cleanup() {
  if (llamaProcess) {
    console.log('Shutting down LLaMA process...');
    llamaProcess.kill('SIGTERM');
  }
}

process.on('SIGINT', () => {
  cleanup();
  process.exit();
});

process.on('SIGTERM', () => {
  cleanup();
  process.exit();
});

process.on('exit', cleanup);