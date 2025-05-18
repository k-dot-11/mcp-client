import express from 'express';
import cors from 'cors';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { OllamaMCPClient } from './chaosspacemarine';

const app = express();
const port = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize MCP client
const client = new OllamaMCPClient({ debug: true });
client.connect("./jiral.js")
  .then(() => console.log("MCP client connected"))
  .catch(err => console.error("Connection failed:", err));

// Streaming chat endpoint
app.post('/chat', async (req, res) => {
  const { query } = req.body;
  
  if (!query) {
    return res.status(400).json({ error: "Query parameter required" });
  }

  try {
    // Set streaming headers
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();  // Immediate header flush

    // Create async generator stream with timing control
    const responseStream = Readable.from(
      client.processQuery(query)
    );

    // Add stream logging
    responseStream
      .on('data', (chunk) => console.log('Sending chunk:', chunk.toString().trim()))
      .on('end', () => console.log('✅ Stream completed'))
      .on('error', (err) => console.error('🚨 Stream error:', err));

    // Pipe with error handling
    await pipeline(
      responseStream,
      res
    ).catch(err => console.error('Pipeline error:', err));

  } catch (error) {
    console.error("Processing error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Processing failed" });
    }
  }
});

app.listen(port, () => {
  console.log(`Streaming API available at http://localhost:${port}/chat`);
});
