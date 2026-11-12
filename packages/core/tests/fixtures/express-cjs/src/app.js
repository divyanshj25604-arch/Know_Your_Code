const express = require('express');
const authRoutes = require('./routes/auth');

const app = express();
app.use(express.json());
app.use('/auth', authRoutes);

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

module.exports = app;
