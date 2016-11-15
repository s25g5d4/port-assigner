const express = require('express');
const sequelize = require('sequelize');

const SwitchList = require('../../models/switch-list');
const sql = require('../../models/sql');
const redis = require('../../models/redis')();
const { getMACPortIndex } = require('../../models/switch-snmp');
const { extractOption82 } = require('../../models/option-82');
const { getUserIpBySwitchPort } = require('../../models/get-user-ip');
const { redisValue: { decodeSwitchInfo }, mac: { decimalToMac, macToDecimal }, ip: { decimalToDottedIp, isZero } } = require('../../helpers');

const globalLease = require('config').get('DHCP.lease');
const globalDNS = require('config').get('DHCP.DNS');

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

const router = express.Router();

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

router.post('/discover', function (req, res, next) {
  const giaddr = decimalToDottedIp(req.body.giaddr);
  const chaddr = decimalToMac(req.body.chaddr);
  const xid = req.body.xid.map(e => e.toString(16)).join('');
  const option82 = req.body.options['82'] || [];

  const respondNotFound = () => {
    console.log('discover', `"${chaddr}" not found; may be missing giaddr or relay agent information`);
    res
      .set('Content-Type', 'Application/json')
      .status(404)
      .send('{}')
      .end();
  };

  const respondForbidFakeIp = () => {
    console.log('discover', `too many fake ip sent to ${chaddr}`);

    res
      .set('Content-Type', 'Application/json')
      .status(403)
      .send('{}')
      .end();
  };

  const respondServerError = err => {
    console.error('discover', err);
    res
      .set('Content-Type', 'Application/json')
      .status(500)
      .send('{}')
      .end();
  };

  const respondFakeIp = () => {
    console.log('discover', `send fake ip for ${chaddr}`);
    res
      .set('Content-Type', 'Application/json')
      .status(200)
      .send(JSON.stringify(fakeIp))
      .end();
  };

  const respondJSON = resJSON => {
    console.log('discover', `response: ${resJSON}`);
    res
      .set('Content-Type', 'Application/json')
      .status(200)
      .send(resJSON)
      .end();
  };

  const writeXid = (xid, edgeIp, portIndex, resJSON) => {
    const xidKey = `${chaddr}:${xid}`;
    console.log('discover', `write xid ${xidKey}`);

    return redis.set(xidKey, `${edgeIp}:${portIndex}:${resJSON}`)
      .then(() => redis.expire(xidKey, 300));
  };

  const writeMacCache = (edgeIp, portIndex, resJSON) => {
    const edgeMacKey = `${edgeIp}:${chaddr}`;
    console.log('discover', `write cache ${edgeMacKey}`);

    return redis.set(edgeMacKey, `${edgeIp}:${portIndex}:${resJSON}`)
      .then(() => redis.expire(edgeMacKey, globalLease * 10));
  };

  const writeFakeIp = xid => {
    const macFakeIpKey = `${chaddr}:fake_ip`;
    console.log('discover', `write fake ip ${macFakeIpKey}`);

    redis.rpush(macFakeIpKey, `${xid}`)
      .then(() => redis.expire(macFakeIpKey, 3600));
  };

  if (isZero(giaddr) || !option82) {
    respondNotFound();
    return;
  }

  console.log('discover', 'get user ip with option 82');
  getUserIpWithOption82(giaddr, chaddr, option82)
    .then(([ edge, portIndex, resObj ]) => {
      writeMacCache(edge.ip, portIndex, JSON.stringify(resObj));
      return Promise.resolve([ edge, portIndex, resObj ]);
    })
    .catch(err => {
      if (err.type === 'snmp not found' || err.type === 'user ip not found') {
        console.log('discover', err.message);

        console.log('discover', 'get user ip from cache');
        return getUserIpFromCache(giaddr, chaddr, option82);
      }

      return Promise.reject(err);
    })
    .then(([ edge, portIndex, resObj ]) => {
      const resJSON = JSON.stringify(resObj);

      writeXid(xid, edge.ip, portIndex, resJSON);

      console.log('discover', `${chaddr} is at ${edge.ip} port ${portIndex}`);
      respondJSON(resJSON);
      return Promise.resolve();
    })
    .catch(err => {
      if (err.type === 'key not found') {
        console.log('discover', err.message);
        console.log('discover', 'trying to send fake ip');

        const macFakeIpKey = `${chaddr}:fake_ip`;
        return Promise.all([ Promise.resolve(macFakeIpKey), redis.llen(macFakeIpKey) ])
          .then(([ key, fakeIpCount ]) => {
            if (fakeIpCount >= 10) {
              respondForbidFakeIp();
            }
            else {
              writeFakeIp(xid);
              respondFakeIp();
            }

            return Promise.resolve();
          });
      }

      return Promise.reject(err);
    })
    .catch(err => {
      respondServerError(err);
      // return Promise.reject(err);
    });
});

router.post('/request', function (req, res, next) {
  const giaddr = decimalToDottedIp(req.body.giaddr);
  const ciaddr = decimalToDottedIp(req.body.ciaddr);
  const chaddr = decimalToMac(req.body.chaddr);
  const requestedIp = req.body.options['50'] ? decimalToDottedIp(req.body.options['50']) : '';
  const xid = req.body.xid.map(e => e.toString(16)).join('');

  const respondNotFound = () => {
    console.log('request', `"${chaddr}" not found; may be missing giaddr or relay agent information`);

    res
      .set('Content-Type', 'Application/json')
      .status(404)
      .send('{}')
      .end();
  };

  const respondServerError = err => {
    console.error('request', err);

    res
      .set('Content-Type', 'Application/json')
      .status(500)
      .send('{}')
      .end();
  };

  const respondForbidden = () => {
    console.log('request', `"${chaddr}" requesting for ${requestedIp} is forbidden`);

    res
      .set('Content-Type', 'Application/json')
      .status(403)
      .send(`{"requested_ip_address":"${requestedIp}"}`)
      .end();
  };

  const respondFakeIp = () => {
    console.log('request', `send fake ip for ${chaddr}`);

    res
      .set('Content-Type', 'Application/json')
      .status(200)
      .send(JSON.stringify(fakeIp))
      .end();
  };

  const respondJSON = resJSON => {
    console.log('request', `response: ${resJSON}`);

    res
      .set('Content-Type', 'Application/json')
      .status(200)
      .send(resJSON)
      .end();
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
    console.log('request', `delete ${xidKey}`);

    return redis.del(xidKey);
  };

  const writeMacCache = (edgeIp, portIndex, resJSON) => {
    const edgeMacKey = `${edgeIp}:${chaddr}`;
    console.log('discover', `write cache ${edgeMacKey}`);

    return redis.set(edgeMacKey, `${edgeIp}:${portIndex}:${resJSON}`)
      .then(() => redis.expire(edgeMacKey, globalLease * 10));
  };

  if (isZero(giaddr) || isZero(requestedIp) || !req.body.options['82']) {
    respondNotFound();
    return;
  }

  if (requestedIp === fakeIp.yiaddr) {
    console.log('request', `receive fake ip request from ${chaddr} with xid ${xid}`);

    const macFakeIpKey = `${chaddr}:fake_ip`;

    Promise.all([ Promise.resolve(macFakeIpKey), redis.lrange(macFakeIpKey, 0, -1) ])
      .then(([ key, cachedXids ]) => {

        if (!cachedXids || cachedXids.length === 0) {
          return Promise.reject({
            'type': 'key not found',
            'data': { 'key': key },
            'message': `redis key ${key} not found`
          });
        }
        else if (cachedXids.indexOf(xid) < 0) {
          return Promise.reject({
            'type': 'xid not match',
            'data': {
              'expected': cachedXids,
              'received': xid
            },
            'message': `fake_ip record xid does not match; expected ${JSON.stringify(cachedXids)}, received: ${xid}`
          });
        }
        else {
          respondFakeIp();
          return Promise.resolve();
        }

      })
      .catch(err => {
        if (err.type) {
          if (err.type === 'key not found' || err.type === 'xid not match') {
            console.log('request', err.message);
            respondForbidden();
            return Promise.resolve();
          }
        }

        return Promise.reject(err);
      })
      .catch(err => {
        respondServerError(err);
        // return Promise.reject(err);
      });

    return;

  }

  console.log('request', 'get user ip with xid');
  getUserIpWithXid(xid, chaddr)
    .then( res => {
      console.log('request', `xid found: ${xid}`);
      removeXid(xid);
      return Promise.resolve(res);
    })
    .catch(err => {
      if (err.type && err.type === 'key not found') {
        console.log('request', `xid not found: ${err.data.key}`);

        // if (isZero(ciaddr)) {
        //   return Promise.reject({
        //   'type': 'xid not found',
        //   'data': {
        //     'xid': xid
        //   },
        //   'message': `DHCPREQUEST from ${chaddr} xid ${xid} not found and ciaddr is zero`
        //   });
        // }

        console.log('request', 'get user ip with option 82');
        return getUserIpWithOption82(giaddr, chaddr, req.body.options['82'])
          .then(([edge, portIndex, resObj]) => {
            writeMacCache(edge.ip, portIndex, JSON.stringify(resObj));
            return Promise.resolve([ edge, portIndex, resObj ]);
          });
      }

      else return Promise.reject(err);
    })
    .then(([edge, portIndex, resObj]) => {
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

      console.log('request', `${chaddr} is at ${edge.ip} port ${portIndex}`);
      respondJSON(JSON.stringify(resObj));

      console.log('request', `push check_port ${edge.ip}:${portIndex}:${chaddr}:${Date.now()}`);
      redis.rpush('check_port', `${edge.ip}:${portIndex}:${chaddr}:${Date.now()}`)
        .then(() => {
          console.log('request', 'publish check_port notify');
          redis.publish('check_port:notify', '');
        });

      return Promise.resolve();
    })
    .catch(err => {
      if (err.type === 'option not match' || err.type === 'user ip not found' || err.type === 'xid not found' || err.type === 'snmp not found') {
        console.log('request', err.message);
        respondForbidden();
        return Promise.resolve();
      }

      return Promise.reject(err);
    })
    .catch(err => {
      respondServerError(err);
      // return Promise.reject(err);
    });
});

module.exports = router;
