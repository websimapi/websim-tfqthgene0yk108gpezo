const express = require('express');
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
  const llamaUrl = 'https://huggingface.co/Mozilla/llava-v1.5-7b-llamafile/resolve/main/llava-v1.5-7b-q4.llamafile';
  const llamaPath = path.join(__dirname, 'llava-v1.5-7b-q4.llamafile');

  // Check if file already exists and is not empty
  if (fs.existsSync(llamaPath)) {
    const stats = fs.statSync(llamaPath);
    if (stats.size > 0) {
      console.log('LLaMA file already exists, skipping download');
      return Promise.resolve();
    }
  }

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(llamaPath);
    
    const request = https.get(llamaUrl, (response) => {
      // Handle redirects
      if (response.statusCode === 302 || response.statusCode === 301) {
        https.get(response.headers.location, (redirectResponse) => {
          const totalBytes = parseInt(redirectResponse.headers['content-length'], 10);
          let downloadedBytes = 0;

          redirectResponse.pipe(file);

          redirectResponse.on('data', (chunk) => {
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
        }).on('error', (err) => {
          fs.unlink(llamaPath, () => {}); // Delete the file on error
          reject(err);
        });
      } else {
        // Direct download without redirect
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
      }
    }).on('error', (err) => {
      fs.unlink(llamaPath, () => {}); // Delete the file on error
      reject(err);
    });

    request.on('error', (err) => {
      fs.unlink(llamaPath, () => {}); // Delete the file on error
      reject(err);
    });
  });
}

function startLlama() {
  const llamaPath = path.join(__dirname, 'llava-v1.5-7b-q4.llamafile');
  // Use proper shell command formatting
  llamaProcess = exec(`"${llamaPath}" --server --port 8080`, {
    shell: true,
    windowsHide: true
  });
  
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

  llamaProcess.on('error', (error) => {
    console.error('Failed to start LLaMA process:', error);
    llamaStatus = 'Error';
    broadcastToAll({ type: 'llamaStatus', status: llamaStatus });
  });

  llamaProcess.on('exit', (code, signal) => {
    console.log(`LLaMA process exited with code ${code} and signal ${signal}`);
    llamaStatus = 'Stopped';
    broadcastToAll({ type: 'llamaStatus', status: llamaStatus });
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
  console.log(`Server running at http://localhost:${port}`);
});

// Cleanup on process exit
process.on('SIGINT', () => {
  if (llamaProcess) {
    llamaProcess.kill();
  }
  process.exit();
});

process.on('SIGTERM', () => {
  if (llamaProcess) {
    llamaProcess.kill();
  }
  process.exit();
});