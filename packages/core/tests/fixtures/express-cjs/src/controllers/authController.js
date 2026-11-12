const { findUserByEmail } = require('../services/userService');

async function login(req, res) {
  const user = await findUserByEmail(req.body.email);
  if (!user) return res.status(401).json({ error: 'Invalid' });
  res.json({ id: user.id });
}

module.exports = { login };
