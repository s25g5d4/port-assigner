const createSocket = require('./createSocket');

module.exports = function exportIo(server) {
  const io = createSocket(server);

  return {
    'dhcp': require('./dhcp')(io),
    'io': io
  };
};
