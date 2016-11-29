const winston = require('winston');

const app = require('../app');
const SwitchList = require('../models/switch-list');
const redis = require('../models/redis')();

const generateDhcpIoMsg = message => {
  const dhcpIoMsg = {};
  dhcpIoMsg.timestamp = message.timestamp;
  dhcpIoMsg.requestType = `DHCP${message.requestType.toUpperCase()}`;
  dhcpIoMsg.xid = message.xid;
  dhcpIoMsg.chaddr = message.chaddr;
  dhcpIoMsg.edge = message.edge;
  dhcpIoMsg.fakeIp = (message.message.search('fake ip') >= 0);

  if (!dhcpIoMsg.fakeIp) {
    dhcpIoMsg.portIndex = message.portIndex;
    dhcpIoMsg.yiaddr = message.yiaddr;
    dhcpIoMsg.subnetMask = message.subnetMask;
    dhcpIoMsg.router = message.router;
  }

  if (dhcpIoMsg.requestType === 'DHCPREQUEST') {
    dhcpIoMsg.requestedIp = message.requestedIp;
    if (message.message === 'option not match') {
      dhcpIoMsg.what = message.what;
      dhcpIoMsg.expected = message.expected;
      dhcpIoMsg.received = message.received;
    }
  }

  return dhcpIoMsg;
};

module.exports = function createDhcpIo(io) {
  const dhcpIo = io.of('/dhcp');

  dhcpIo.on('connection', socket => {
    winston.debug('socket.io user connected');

    socket.on('select switch', selectedSwitch => {
    winston.debug('socket.io user select', { 'selectedSwitch': selectedSwitch });

      SwitchList.findById(selectedSwitch, { attributes: [ 'ip' ], 'raw': true })
        .then(list => {
          if (!list) {
            winston.error('socket.io user select invalid switch', { 'selectedSwitch': selectedSwitch });

            socket.disconnect('selected switch not found');
            return Promise.resolve();
          }

          winston.debug('socket.io user join', { 'room': selectedSwitch });

          socket.join(selectedSwitch);
          socket.swtichSelected = true;
        });

    });
  });

  redis.subscribe('dhcp', (err, count) => {
    if (err) winston.error(err);
    if (!count) winston.error('redis subscribe failed');
  });

  redis.on('message', (channel, messageRaw) => {
    const message = JSON.parse(messageRaw);

    winston.debug('redis channel dhcp get message', { 'messageRaw': messageRaw });

    if (message.level === 'info') {
      const dhcpIoMsg = generateDhcpIoMsg(message);

      winston.debug('emit dhcp message', dhcpIoMsg);
      dhcpIo.to(dhcpIoMsg.edge).emit('dhcp request', dhcpIoMsg);
    }
  });

};