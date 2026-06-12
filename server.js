const express = require('express');
const { PORT } = require('./config.js');

let app = express();

// 1. CRITICAL: This allows Express to read the JSON prompts sent from your frontend chat box
app.use(express.json());

app.use(express.static('wwwroot'));
app.use(require('./routes/auth.js'));
app.use(require('./routes/models.js'));

// 2. CRITICAL: This mounts the AI Agent so the /api/agent/ask route actually exists
app.use(require('./routes/agent.js'));

app.listen(PORT, function () { console.log(`Server listening on port ${PORT}...`); });