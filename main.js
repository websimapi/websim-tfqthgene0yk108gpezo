class ServerGenerator {
  constructor() {
    this.zip = new JSZip();
    this.websocket = null;
    this.llamaStatus = 'Not Initialized';
    this.setupEventListeners();
    this.connectWebSocket();
  }

  setupEventListeners() {
    document.getElementById('downloadBtn').addEventListener('click', () => this.generateAndDownload());
    document.getElementById('sendPrompt').addEventListener('click', () => this.sendPrompt());
  }

  connectWebSocket() {
    this.websocket = new WebSocket('ws://localhost:3000');
    
    this.websocket.onopen = () => {
      document.getElementById('status').textContent = 'WebSocket Status: Connected';
      document.getElementById('status').style.borderColor = '#2ecc71';
    };

    this.websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleWebSocketMessage(data);
    };

    this.websocket.onclose = () => {
      document.getElementById('status').textContent = 'WebSocket Status: Disconnected';
      document.getElementById('status').style.borderColor = '#e74c3c';
      setTimeout(() => this.connectWebSocket(), 5000);
    };
  }

  handleWebSocketMessage(data) {
    switch(data.type) {
      case 'llamaStatus':
        this.updateLlamaStatus(data.status);
        break;
      case 'llamaResponse':
        this.displayResponse(data.response);
        break;
      case 'downloadProgress':
        this.updateDownloadProgress(data.progress);
        break;
    }
  }

  updateLlamaStatus(status) {
    this.llamaStatus = status;
    document.getElementById('llamaStatus').textContent = `LLaMA Status: ${status}`;
    document.getElementById('llamaStatus').style.borderColor = 
      status === 'Ready' ? '#2ecc71' : 
      status === 'Initializing' ? '#f1c40f' : '#e74c3c';
  }

  updateDownloadProgress(progress) {
    const progressBar = document.querySelector('.progress-bar-fill');
    if (progressBar) {
      progressBar.style.width = `${progress}%`;
    }
  }

  async sendPrompt() {
    const promptInput = document.getElementById('prompt');
    const promptText = promptInput.value.trim();
    
    if (!promptText) return;

    const responseDiv = document.getElementById('response');
    responseDiv.textContent = 'Processing...';
    document.getElementById('sendPrompt').classList.add('loading');

    this.websocket.send(JSON.stringify({
      type: 'prompt',
      prompt: promptText
    }));
  }

  displayResponse(response) {
    const responseDiv = document.getElementById('response');
    responseDiv.textContent = response;
    document.getElementById('sendPrompt').classList.remove('loading');
  }

  generateServerJs() {
    return `const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const fs = require('fs');
const https = require('https');
const { exec } = require('child_process');
const path = require('path');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let llamaProcess = null;
let llamaStatus = 'Not Initialized';

async function downloadLlama() {
  const llamaUrl = 'https://huggingface.co/Mozilla/llava-v1.5-7b-llamafile/resolve/main/llava-v1.5-7b-q4.llamafile?download=true';
  const llamaPath = path.join(__dirname, 'llava-v1.5-7b-q4.llamafile');

  if (!fs.existsSync(llamaPath)) {
    const file = fs.createWriteStream(llamaPath);
    
    return new Promise((resolve, reject) => {
      https.get(llamaUrl, (response) => {
        const totalBytes = parseInt(response.headers['content-length'], 10);
        let downloadedBytes = 0;

        response.pipe(file);

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          const progress = (downloadedBytes / totalBytes) * 100;
          broadcastToAll({
            type: 'downloadProgress',
            progress: Math.round(progress)
          });
        });

        file.on('finish', () => {
          file.close();
          fs.chmodSync(llamaPath, '755');
          resolve();
        });
      }).on('error', reject);
    });
  }
  return Promise.resolve();
}

function startLlama() {
  const llamaPath = path.join(__dirname, 'llava-v1.5-7b-q4.llamafile');
  llamaProcess = exec(\`\${llamaPath} --server --port 8080\`);
  
  llamaProcess.stdout.on('data', (data) => {
    console.log('LLaMA output:', data);
    if (data.includes('server listening')) {
      llamaStatus = 'Ready';
      broadcastToAll({ type: 'llamaStatus', status: llamaStatus });
    }
  });

  llamaProcess.stderr.on('data', (data) => {
    console.error('LLaMA error:', data);
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
        
        const result = await response.json();
        ws.send(JSON.stringify({
          type: 'llamaResponse',
          response: result.content
        }));
      } catch (error) {
        ws.send(JSON.stringify({
          type: 'llamaResponse',
          response: 'Error processing prompt: ' + error.message
        }));
      }
    }
  });
});

async function initialize() {
  try {
    llamaStatus = 'Downloading';
    broadcastToAll({ type: 'llamaStatus', status: llamaStatus });
    await downloadLlama();
    
    llamaStatus = 'Initializing';
    broadcastToAll({ type: 'llamaStatus', status: llamaStatus });
    startLlama();
  } catch (error) {
    console.error('Error initializing LLaMA:', error);
    llamaStatus = 'Error';
    broadcastToAll({ type: 'llamaStatus', status: llamaStatus });
  }
}

initialize();

app.get('/', (req, res) => {
  res.send('Node.js WebSocket Server Running with LLaMA Integration');
});

server.listen(port, () => {
  console.log(\`Server running at http://localhost:\${port}\`);
});`;
  }

  generatePackageJson() {
    return {
      name: "nodejs-websocket-server",
      version: "1.0.0",
      description: "A Node.js server with WebSocket support and LLaMA integration",
      main: "server.js",
      scripts: {
        start: "node server.js"
      },
      dependencies: {
        express: "^4.17.1",
        ws: "^8.2.3",
        cors: "^2.8.5"
      }
    };
  }

  generateReadme() {
    return `# Node.js WebSocket Server with LLaMA Integration

This is a Node.js server with WebSocket support and LLaMA integration.

## Installation

1. Extract the ZIP file
2. Open a terminal in the extracted directory
3. Run \`npm install\` to install dependencies
4. Run \`npm start\` to start the server

## Features

- Express.js web server
- WebSocket support
- CORS enabled
- LLaMA integration for AI capabilities
- Basic error handling

## Usage

The server will start on port 3000 by default. The LLaMA service will run on port 8080.
You can connect to the WebSocket server at \`ws://localhost:3000\`.

## API Endpoints

- GET / - Returns a simple message confirming the server is running

## LLaMA Integration

The server automatically downloads and manages the LLaMA model. Features include:
- Automatic download of LLaMA model
- WebSocket-based prompt/response system
- Status monitoring`;
  }

  async generateAndDownload() {
    this.zip.file('package.json', JSON.stringify(this.generatePackageJson(), null, 2));
    this.zip.file('server.js', this.generateServerJs());
    this.zip.file('README.md', this.generateReadme());

    try {
      const content = await this.zip.generateAsync({type: 'blob'});
      const url = window.URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'nodejs-websocket-server.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error generating zip:', error);
    }
  }
}

// Initialize the generator when the page loads
window.addEventListener('load', () => {
  new ServerGenerator();
});