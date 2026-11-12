const { formatUser } = require('../../../shared/index.js');

function profile(u) {
  return formatUser(u);
}
module.exports = { profile };
