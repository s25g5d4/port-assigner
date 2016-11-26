const express = require('express');
const sequelize = require('sequelize');
const winston = require('winston');
const moment = require('moment');

const SwitchList = require('../../models/switch-list');
const sql = require('../../models/sql');
const redis = require('../../models/redis')();
const { getMACPortIndex } = require('../../models/switch-snmp');
const { extractOption82 } = require('../../models/option-82');
const { getUserIpBySwitchPort } = require('../../models/get-user-ip');
const { redisValue: { decodeSwitchInfo }, mac: { decimalToMac, macToDecimal }, ip: { decimalToDottedIp, isZero } } = require('../../helpers');

const globalLease = require('config').get('DHCP.lease');
const globalDNS = require('config').get('DHCP.DNS');

require('winston-redis').Redis;

const logger = new winston.Logger({
  'level': 'info',
  transports: [
    new winston.transports.Console({
      'timestamp': () => {
        return moment().format('YYYY-MM-DD HH:mm:ss Z');
      },
      'colorize': true
    }),
    new winston.transports.Redis({ 'channel': 'dhcp' })
  ]
});

setImmediate(() => {
  const app = require('../../app');
  if (app.get('env') === 'development') {
    logger.transports.console.level = 'debug';
  }
});

const fakeIp = {
  "yiaddr": "140.117.1.1",
  "router": "140.117.1.2",
  "subnet_mask": "255.255.255.0",
  "ip_address_lease_time": 1
};

const generateResponse = function generateResponse(ip, gateway, mask, lease, dns, serverIdentifier) {
  const responseObject = {};
  responseObject.yiaddr = ip;
  responseObject.router = gateway;
  responseObject.subnet_mask = mask;
  responseObject.ip_address_lease_time = lease;
  responseObject.domain_name_servers = dns;
  responseObject.server_identifier = serverIdentifier;

  return responseObject;
};

const getEdgeInfo = function getBbInfo(bbIp, option82) {
  const bbInfoKey = `${bbIp}:info`;

  return Promise.all([ Promise.resolve(bbInfoKey), redis.get(bbInfoKey) ])
    .then(([ key, bbInfoRaw ]) => {
      if (!bbInfoRaw) {
        return Promise.reject({
          'type': 'key not found',
          'data': { 'key': key },
          'message': `redis key "${key}" not found`
        });
      }

      const bbInfo = decodeSwitchInfo(bbInfoRaw);
      const relayInfo = extractOption82(bbInfo.name, option82);

      const bbPortKey = `${bbInfo.ip}:${relayInfo.port}`;
      return Promise.all([ Promise.resolve(bbPortKey), redis.get(bbPortKey) ]);
    });
};

const getUserIpWithOption82 = function getUserIpWithOption82(giaddr, chaddr, option82) {
  return getEdgeInfo(giaddr, option82)
    .then(([ key, edgeRaw ]) => {
      if (!edgeRaw) {
        return Promise.reject({
          'type': 'key not found',
          'data': { 'key': key },
          'message': `redis key "${key}" not found`
        });
      }

      const edge = decodeSwitchInfo(edgeRaw);

      return Promise.all([ Promise.resolve(edge), getMACPortIndex(edge.ip, edge.community, macToDecimal(chaddr)) ]);
    })
    .then(([ edge, portIndex ]) => {
      return Promise.all([ Promise.resolve(edge), Promise.resolve(portIndex), getUserIpBySwitchPort(edge.ip, portIndex) ]);
    })
    .then(([ edge, portIndex, userIp ]) => {
      return Promise.resolve([ edge, portIndex, generateResponse(userIp.ip, userIp.gateway, edge.mask, globalLease, globalDNS, giaddr) ]);
    });
};

const getUserIpFromCache = function getUserIpFromCache(giaddr, chaddr, option82) {
  return getEdgeInfo(giaddr, option82)
    .then(([ key, edgeRaw ]) => {
      if (!edgeRaw) {
        return Promise.reject({
          'type': 'key not found',
          'data': { 'key': key },
          'message': `redis key "${key}" not found`
        });
      }

      const edge = decodeSwitchInfo(edgeRaw);

      const edgeMacKey = `${edge.ip}:${chaddr}`;
      return Promise.all([ Promise.resolve(edge), Promise.resolve(edgeMacKey), redis.get(edgeMacKey)])
        .then(([edge, key, userInfo]) => {
          if (!userInfo) {
            return Promise.reject({
              'type': 'key not found',
              'data': { 'key': key },
              'message': `redis key "${key}" not found`
            });
          }
          const [ , portIndex, resJSON ] = userInfo.match(/^([^:]+):([^:]+):(.*)/).slice(1);
          const resObj = JSON.parse(resJSON);
          return Promise.resolve([ edge, portIndex, resObj ]);
        });
    });
};

const getUserIpWithXid = function getUserIpWithXid(xid, chaddr) {
  const xidKey = `${chaddr}:${xid}`;
  return Promise.all([ Promise.resolve(xidKey), redis.get(xidKey) ])
    .then(([ key, userInfo ]) => {
      if (!userInfo) {
        return Promise.reject({
          'type': 'key not found',
          'data': { 'key': key },
          'message': `redis key "${key}" not found`
        });
      }

      const [ edgeIp, portIndex, resJSON ] = userInfo.match(/^([^:]+):([^:]+):(.*)/).slice(1);

      const resObj = JSON.parse(resJSON);
      return Promise.resolve([ { 'ip': edgeIp }, portIndex, resObj ]);
    });
};

const respondNotFound = function respondNotFound(res, log) {
  // console.log('discover', `"${chaddr}" not found; may be missing giaddr or relay agent information`);
  logger.info(log.message, log.data);

  res
    .set('Content-Type', 'Application/json')
    .status(404)
    .send('{}')
    .end();
};

const respondForbidden = function respondForbidden(res, log, resJSON) {
  // console.log('discover', `too many fake ip sent to ${chaddr}`);
  logger.info(log.message, log.data);

  resJSON = resJSON || '{}';
  res
    .set('Content-Type', 'Application/json')
    .status(403)
    .send(resJSON)
    .end();
};

const respondServerError = function respondServerError(res, log) {
  logger.error(log.message, log.data);
  logger.debug(log.message, Object.assign({ 'stack': log.stack }, log.data));

  res
    .set('Content-Type', 'Application/json')
    .status(500)
    .send('{}')
    .end();
};

const respondJSON = function respondJSON(res, log, resJSON) {
  if (typeof resJSON !== 'string') throw TypeError('resJSON is not a string');

  // console.log('discover', `response: ${resJSON}`);
  logger.info(log.message, log.data);
  logger.debug(log.message, Object.assign({ 'response': resJSON }, log.data));

  res
    .set('Content-Type', 'Application/json')
    .status(200)
    .send(resJSON)
    .end();
};

const writeMacCache = (edgeIp, portIndex, chaddr, resJSON, loggingData) => {
  const edgeMacKey = `${edgeIp}:${chaddr}`;
  logger.debug('write cache', Object.assign({ 'key': edgeMacKey }, loggingData));

  return redis.set(edgeMacKey, `${edgeIp}:${portIndex}:${resJSON}`)
    .then(() => redis.expire(edgeMacKey, globalLease * 10));

};

const router = express.Router();

router.post('/discover', function (req, res, next) {
  const giaddr = decimalToDottedIp(req.body.giaddr);
  const chaddr = decimalToMac(req.body.chaddr);
  const xid = req.body.xid.map(e => e.toString(16)).join('');
  const option82 = req.body.options['82'] || [];

  const loggingData = {
    'requestType': 'discover',
    'xid': xid,
    'chaddr': chaddr
  };

  const writeXid = (edgeIp, portIndex, resJSON) => {
    const xidKey = `${chaddr}:${xid}`;
    logger.debug('write xid', Object.assign({ 'key': xidKey }, loggingData));

    return redis.set(xidKey, `${edgeIp}:${portIndex}:${resJSON}`)
      .then(() => redis.expire(xidKey, 300));
  };

  const writeFakeIp = xid => {
    const macFakeIpKey = `${chaddr}:fake_ip`;
    logger.debug('write fake ip', Object.assign({ 'key': macFakeIpKey }, loggingData));

    redis.rpush(macFakeIpKey, `${xid}`)
      .then(() => redis.expire(macFakeIpKey, 3600));
  };

  const checkAndSendFakeIp = () => {
    const macFakeIpKey = `${chaddr}:fake_ip`;
    return Promise.all([ Promise.resolve(macFakeIpKey), redis.llen(macFakeIpKey) ])
      .then(([ key, fakeIpCount ]) => {
        if (fakeIpCount >= 10) {
          respondForbidden(res, {
            'message': 'too many fake ip tries',
            'data': Object.assign({ 'fakeIpCount': fakeIpCount }, loggingData)
          });
        }
        else {
          writeFakeIp(xid);

          respondJSON(res, {
            'message': 'send fake ip',
            'data': Object.assign({ 'fakeIpCount': fakeIpCount + 1 }, loggingData)
          }, JSON.stringify(fakeIp));
        }

        return Promise.resolve();
      });

  };

  if (isZero(giaddr)) {
    respondNotFound(res, {
      'message': 'giaddr not found',
      'data': loggingData
    });

    return;
  }

  loggingData.giaddr = giaddr;

  if (!option82) {
    respondNotFound(res, {
      'message': 'Option 82 Relay Agent Information not found',
      'data': loggingData
    });

    return;
  }

  logger.debug('get user ip with option 82', loggingData);

  getUserIpWithOption82(giaddr, chaddr, option82)
    .then(([ edge, portIndex, resObj ]) => {
      loggingData.edge = edge.ip;
      loggingData.portIndex = portIndex;
      loggingData.yiaddr = resObj.yiaddr;
      loggingData.subnetMask = resObj.subnet_mask;
      loggingData.router = resObj.router;

      logger.debug('user ip found', loggingData);

      writeMacCache(edge.ip, portIndex, chaddr, JSON.stringify(resObj), loggingData);

      return Promise.resolve([ edge, portIndex, resObj ]);
    })
    .catch(err => {
      // fail to get user ip with option 82
      if (err.type === 'snmp not found' || err.type === 'user ip not found') {
        const localLoggingData = {};
        Object.assign(localLoggingData, loggingData);
        Object.assign(localLoggingData, err.data);
        logger.debug(err.type, localLoggingData);

        logger.debug('get user ip from cache', loggingData);
        return getUserIpFromCache(giaddr, chaddr, option82)
          .then(([ edge, portIndex, resObj ]) => {
            loggingData.edge = edge.ip;
            loggingData.portIndex = portIndex;
            loggingData.yiaddr = resObj.yiaddr;
            loggingData.subnetMask = resObj.subnet_mask;
            loggingData.router = resObj.router;
            loggingData.cache = true;

            return Promise.resolve([ edge, portIndex, resObj ]);
          });
      }

      return Promise.reject(err);
    })
    .then(([ edge, portIndex, resObj ]) => {
      const resJSON = JSON.stringify(resObj);

      writeXid(edge.ip, portIndex, resJSON);

      respondJSON(res, {
        'message': 'send response',
        'data': loggingData
      }, resJSON);

      return Promise.resolve();
    })
    .catch(err => {
      // fail to get user ip from cache
      if (err.type === 'key not found') {
        if (err.data.key.search( new RegExp(`${chaddr}$`) ) < 0) return Promise.reject(err);
          const localLoggingData = {};
          Object.assign(localLoggingData, loggingData);
          Object.assign(localLoggingData, err.data);
          logger.debug(err.type, localLoggingData);

          return getEdgeInfo(giaddr, option82)
          .then(([ key, edgeRaw ]) => {
            if (!edgeRaw) {
              return Promise.reject({
                'type': 'key not found',
                'data': { 'key': key },
                'message': `redis key "${key}" not found`
              });
            }

            const edge = decodeSwitchInfo(edgeRaw);
            loggingData.edge = edge.ip;

            logger.debug('trying to send fake ip', loggingData);

            return checkAndSendFakeIp();
          });
      }

      return Promise.reject(err);
    })
    .catch(err => {
      const localLoggingData = {};
      Object.assign(localLoggingData, loggingData);
      Object.assign(localLoggingData, err.data);

      respondServerError(res, {
        'message': err.type || err.message,
        'stack': err.stack || '',
        'data': loggingData
      });
    });
});

router.post('/request', function (req, res, next) {
  const giaddr = decimalToDottedIp(req.body.giaddr);
  const ciaddr = decimalToDottedIp(req.body.ciaddr);
  const chaddr = decimalToMac(req.body.chaddr);
  const requestedIp = req.body.options['50'] ? decimalToDottedIp(req.body.options['50']) : '';
  const option82 = req.body.options['82'] || [];
  const xid = req.body.xid.map(e => e.toString(16)).join('');

  const loggingData = {
    'requestType': 'request',
    'xid': xid,
    'chaddr': chaddr
  };

  const genErrObject = (what, expected, received) => {
    return {
      'type': 'option not match',
      'data': {
        'what': what,
        'expected': expected,
        'received': received
      },
      'message': `${what} does not match; expected ${expected}, received ${received}`
    }
  };

  const removeXid = xid => {
    const xidKey = `${chaddr}:${xid}`;
    logger.debug('remove xid', Object.assign({ 'key': xidKey }, loggingData));

    return redis.del(xidKey);
  };

  if (isZero(giaddr)) {
    respondNotFound(res, {
      'message': 'giaddr not found',
      'data': loggingData
    });

    return;
  }

  loggingData.giaddr = giaddr;

  if (!requestedIp || isZero(requestedIp)) {
    respondNotFound(res, {
      'message': 'requested_ip_address not found',
      'data': loggingData
    });

    return;
  }

  loggingData.requestedIp = requestedIp;

  if (!option82) {
    respondNotFound(res, {
      'message': 'Option 82 Relay Agent Information not found',
      'data': loggingData
    });

    return;
  }

  if (requestedIp === fakeIp.yiaddr) {
    // console.log('request', `receive fake ip request from ${chaddr} with xid ${xid}`);
    getEdgeInfo(giaddr, option82)
      .then(([ key, edgeInfoRaw ]) => {
        if (!edgeInfoRaw) {
          return Promise.reject({
          'type': 'key not found',
          'data': { 'key': key },
          'message': `redis key "${key}" not found`
          });
        }

        const edge = decodeSwitchInfo(edgeInfoRaw);
        loggingData.edge = edge.ip;

        logger.debug('receive fake ip request', loggingData);

        const macFakeIpKey = `${chaddr}:fake_ip`;
        return Promise.all([ edge, Promise.resolve(macFakeIpKey), redis.lrange(macFakeIpKey, 0, -1) ])
      })
      .then(([ edge, key, cachedXids ]) => {
        if (!cachedXids || cachedXids.length === 0) {
          return Promise.reject({
            'type': 'key not found',
            'data': { 'key': key },
            'message': `redis key ${key} not found`
          });
        }

        if (cachedXids.indexOf(xid) < 0) {
          return Promise.reject({
            'type': 'xid not match',
            'data': {
              'expected': cachedXids,
              'received': xid
            },
            'message': `fake_ip record xid does not match; expected ${JSON.stringify(cachedXids)}, received: ${xid}`
          });
        }

        respondJSON(res, {
          'message': 'send fake ip',
          'data': loggingData
        }, JSON.stringify(fakeIp));

        loggingData.portIndex = 0;

        logger.info('push check_port', loggingData);
        redis.rpush('check_port', `${edge.ip}:0:${chaddr}:${Date.now()}`)
          .then(() => {
            logger.debug('publish check_port notify', loggingData);
            return redis.publish('check_port:notify', '');
          });

        return Promise.resolve();
      })
      .catch(err => {
        if (err.type === 'key not found' || err.type === 'xid not match') {
          const localLoggingData = {};
          Object.assign(localLoggingData, loggingData);
          Object.assign(localLoggingData, err.data);
          logger.debug(err.type, localLoggingData);

          respondForbidden(res, {
            'message': 'forbid fake ip request',
            'data': loggingData
          }, `{"requested_ip_address":"${requestedIp}"}`);

          return Promise.resolve();
        }

        return Promise.reject(err);
      })
      .catch(err => {
        const localLoggingData = {};
        Object.assign(localLoggingData, loggingData);
        Object.assign(localLoggingData, err.data);

        respondServerError(res, {
          'message': err.type || err.message,
          'stack': err.stack || '',
          'data': loggingData
        });
      });

    return;
  }

  logger.debug('get user ip with xid', loggingData);

  getUserIpWithXid(xid, chaddr)
    .then(([ edge, portIndex, resObj ]) => {
      loggingData.edge = edge.ip;
      loggingData.portIndex = portIndex;
      loggingData.yiaddr = resObj.yiaddr;
      loggingData.subnetMask = resObj.subnet_mask;
      loggingData.router = resObj.router;

      logger.debug('xid found', loggingData);

      removeXid(xid);

      return Promise.resolve([ edge, portIndex, resObj ]);
    })
    .catch(err => {
      if (err.type === 'key not found') {
        const localLoggingData = {};
        Object.assign(localLoggingData, loggingData);
        Object.assign(localLoggingData, err.data);
        logger.debug('xid not found', localLoggingData);

        logger.debug('get user ip with option 82', loggingData);

        return getUserIpWithOption82(giaddr, chaddr, option82)
          .then(([edge, portIndex, resObj]) => {
            loggingData.edge = edge.ip;
            loggingData.portIndex = portIndex;
            loggingData.yiaddr = resObj.yiaddr;
            loggingData.subnetMask = resObj.subnet_mask;
            loggingData.router = resObj.router;

            logger.debug('user ip found', loggingData);

            writeMacCache(edge.ip, portIndex, chaddr, JSON.stringify(resObj), loggingData);

            return Promise.resolve([ edge, portIndex, resObj ]);
          });

      }

      return Promise.reject(err);
    })
    .then(([ edge, portIndex, resObj ]) => {
      if (!isZero(ciaddr) && ciaddr !== resObj.yiaddr) {
        return Promise.reject(
          genErrObject('ciaddr', resObj.yiaddr, ciaddr)
        );
      }

      if (requestedIp && requestedIp !== resObj.yiaddr) {
        return Promise.reject(
          genErrObject('requested_ip_address', resObj.yiaddr, requestedIp)
        );
      }

      if (req.body.options['1'] && decimalToDottedIp(req.body.options['1']) !== resObj.subnet_mask) {
        return Promise.reject(
          genErrObject('subnet_mask', resObj.subnet_mask, (req.body.options['1'] ? decimalToDottedIp(req.body.options['1']) : ''))
        );
      }

      if (req.body.options['3'] && JSON.stringify( decimalToDottedIp(req.body.options['3'].slice(1)) ) !== JSON.stringify(resObj.router)) {
        return Promise.reject(
          genErrObject('router', resObj.router, (req.body.options['3'] ? decimalToDottedIp(req.body.options['3'].slice(1)) : ''))
        );
      }

      respondJSON(res, {
        'message': 'send response',
        'data': loggingData
      }, JSON.stringify(resObj));

      logger.info('push check_port', loggingData);
      redis.rpush('check_port', `${edge.ip}:${portIndex}:${chaddr}:${Date.now()}`)
        .then(() => {
        logger.debug('publish check_port notify', loggingData);
          redis.publish('check_port:notify', '');
        });

      return Promise.resolve();
    })
    .catch(err => {
      const forbidReasons = [ 'option not match', 'user ip not found', 'xid not found', 'snmp not found' ];
      if (forbidReasons.indexOf(err.type) >= 0) {
        const localLoggingData = {};
        Object.assign(localLoggingData, loggingData);
        Object.assign(localLoggingData, err.data);

        respondForbidden(res, {
          'message': err.type,
          'data': localLoggingData
        }, `{"requested_ip_address":"${requestedIp}","server_identifier": "${giaddr}"}`);

        return Promise.resolve();
      }

      return Promise.reject(err);
    })
    .catch(err => {
      const localLoggingData = {};
      Object.assign(localLoggingData, loggingData);
      Object.assign(localLoggingData, err.data);

      respondServerError(res, {
        'message': err.type || err.message,
        'stack': err.stack || '',
        'data': loggingData
      });
    });
});

module.exports = router;
