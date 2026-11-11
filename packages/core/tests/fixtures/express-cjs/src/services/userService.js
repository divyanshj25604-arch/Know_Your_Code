const User = require('../models/user');

function normalise(email) {
  return email.trim().toLowerCase();
}

async function findUserByEmail(email) {
  return User.findOne({ email: normalise(email) });
}

module.exports = { findUserByEmail };
