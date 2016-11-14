const { getSwitchPortIndex, getMACPortIndex, setAdminStatus } = require('./models/switch-snmp');
const { decodeSwitchInfo } = require('./helpers/redis-value');
const { macToDecimal } = require('./helpers/mac');
const redisConnection = require('./models/redis');
const mq = redisConnection();
const redis = redisConnection();

console.log(`Start at ${(new Date()).toLocaleString()}`);

mq.subscribe('check_port:notify', function (err, count) {
  if (err) throw err;
  if (count === 0) throw 'unable to subscribe check_port:notify';

  console.log(`subscribe on check_port:notify`);
});

mq.on('message', function (channel, message) {
  console.log(`get notify`);

  redis.lpop('check_port')
    .then(portInfo => {
      if (!portInfo) {
        console.log('had been consumed');
        return Promise.resolve('had been consumed');
      }

      const [ edgeIp, portIndexRaw, mac, timestampRaw ] = portInfo.split(':');
      const portIndex = parseInt(portIndexRaw, 10);
      const timestamp = parseInt(timestampRaw, 10);
      const edgeInfoKey = `${edgeIp}:info`;

      return redis.get(edgeInfoKey)
        .then(edgeInfoRaw => {
          const edge = decodeSwitchInfo(edgeInfoRaw);

          const delayGetPortIndex = new Promise((resolve, reject) => {
            console.log(Date.now() - timestamp);
            setTimeout(function () {
              getMACPortIndex(edge.ip, edge.community, macToDecimal(mac))
                .then(resolve)
                .catch(reject);
            }, 500 - (Date.now() - timestamp));
          });

          return Promise.all([ edge, delayGetPortIndex ]);
        })
        .then(([ edge, newPortIndex ]) => {
          if (newPortIndex !== portIndex) {
            console.log(`port changed: ${mac} changed from ${portIndex} to ${newPortIndex} on ${edge.ip}`);
            console.log(`port down: ${newPortIndex} on ${edge.ip}`);

            return setAdminStatus(edge.ip, edge.community, newPortIndex, 'down')
              .then(() => {
                return new Promise((resolve, reject) => {
                  setTimeout(() => {
                    setAdminStatus(edge.ip, edge.community, newPortIndex, 'up')
                      .then(resolve)
                      .catch(reject);
                  }, 5000);
                });
              })
              .then( () => console.log(`port up: ${newPortIndex} on ${edge.ip}`) );
          }
          else {
            console.log(`port unchanged: ${mac} is still at ${newPortIndex} on ${edge.ip}`);
            return Promise.resolve();
          }
        });
    });
});
