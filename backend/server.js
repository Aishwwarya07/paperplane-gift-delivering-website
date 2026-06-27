const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const { initDb } = require('./db');
const authRouter = require('./routes/auth');
const dispatchesRouter = require('./routes/dispatches');
const agentsRouter = require('./routes/agents');
const reportsRouter = require('./routes/reports');

const app = express();
const PORT = process.env.PORT || 5000;

// Setup Middleware
app.use(cors());
app.use(express.json());

// Ensure uploads directory exists and write a dummy sample proof photo
const isVercel = process.env.VERCEL;
const uploadDir = isVercel ? path.join('/tmp', 'uploads') : path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const sampleProofPath = path.join(uploadDir, 'sample-proof.png');
if (!fs.existsSync(sampleProofPath)) {
  const dummyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  fs.writeFileSync(sampleProofPath, Buffer.from(dummyPng, 'base64'));
  console.log('Sample proof-of-delivery image generated.');
}

// Serve uploaded files statically
app.use('/uploads', express.static(uploadDir));

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/dispatches', dispatchesRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/reports', reportsRouter);

// Health check endpoint with database diagnosis
app.get('/api/health', async (req, res) => {
  try {
    const { query, dbType } = require('./db');
    const checkRes = await query('SELECT COUNT(*) as count FROM delivery_agents');
    const count = parseInt(checkRes.rows[0].count || 0);
    res.json({ 
      status: 'OK', 
      dbType,
      agentsCount: count,
      timestamp: new Date() 
    });
  } catch (err) {
    res.json({
      status: 'DB_ERROR',
      error: err.message,
      timestamp: new Date()
    });
  }
});

// Serve static frontend assets if built (for production deployment on Render/Vercel)
const distPath = path.join(__dirname, '../frontend/dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.send('Paper Plane API Server is running. Frontend dev server should be run separately.');
  });
}

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error.'
  });
});

// Database will be initialized on-demand when the first query runs via db.js

// Start listening only when NOT in a serverless environment (like Vercel)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Local Express server listening on port ${PORT}`);
  });
}

// Export app for Vercel serverless function handling
module.exports = app;
