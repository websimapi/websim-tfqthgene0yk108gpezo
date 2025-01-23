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

  // Launch llama process with correct arguments
  llamaProcess = spawn(llamaPath, ['--server', '--port', '8080'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Handle process stdout
  llamaProcess.stdout.on('data', (data) => {
    const output = data.toString();
    console.log('LLaMA output:', output);
    if (output.includes('server listening')) {
      llamaStatus = 'Ready';
      broadcastToAll({ type: 'llamaStatus', status: llamaStatus });
    }
  });

  // Handle process stderr
  llamaProcess.stderr.on('data', (data) => {
    const output = data.toString();
    console.error('LLaMA error:', output);
    if (output.includes('error')) {
      llamaStatus = 'Error';
      broadcastToAll({ type: 'llamaStatus', status: llamaStatus });
    }
  });

  // Handle process errors
  llamaProcess.on('error', (error) => {
    console.error('Failed to start LLaMA process:', error);
    llamaStatus = 'Error';
    broadcastToAll({ type: 'llamaStatus', status: llamaStatus });
  });

  // Handle process exit
  llamaProcess.on('exit', (code, signal) => {
    console.log(`LLaMA process exited with code ${code} and signal ${signal}`);
    llamaStatus = 'Stopped';
    broadcastToAll({ type: 'llamaStatus', status: llamaStatus });
    llamaProcess = null;
  });

  // Set initial status
  llamaStatus = 'Initializing';
  broadcastToAll({ type: 'llamaStatus', status: llamaStatus });
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
        // Make sure llama is ready
        if (llamaStatus !== 'Ready') {
          throw new Error('LLaMA is not ready');
        }

        // Call the llama completion API
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
          throw new Error(`Failed to get response from LLaMA: ${response.statusText}`);
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

// Initialize server and start llama
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
    try {
      // Send SIGTERM to the process group
      process.platform === 'win32' ? 
        llamaProcess.kill() :
        process.kill(-llamaProcess.pid);
    } catch (err) {
      console.error('Error killing LLaMA process:', err);
    }
  }
}

// Handle various termination signals
process.on('SIGINT', () => {
  cleanup();
  process.exit();
});

process.on('SIGTERM', () => {
  cleanup();
  process.exit();
});

process.on('exit', cleanup);