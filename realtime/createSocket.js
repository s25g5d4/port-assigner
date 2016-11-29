module.exports = function createSocket(server) {
  const io = require('socket.io')(server);
  return io;
};
