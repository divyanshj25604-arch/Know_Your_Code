const { formatUser } = require('../../shared/index.js');

function getUser(req, res) {
  res.json({ name: formatUser({ name: ' Ada ' }) });
}
module.exports = { getUser };
