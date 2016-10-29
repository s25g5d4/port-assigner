const express = require('express');
const sequelize = require('sequelize');

const SwitchList = require('../../models/switch-list');
const sql = require('../../models/sql');
const redis = require('../../models/redis');
const { getMACPortIndex } = require('../../models/switch-snmp');
const { extractOption82 } = require('../../models/option-82');
const { getUserIpBySwitchPort } = require('../../models/get-user-ip');

const globalLease = require('config').get('DHCP.lease');
const globalNameServers = require('config').get('DHCP.nameServers');

const router = express.Router();

const decodeSwitchInfo = value => {
  const [ ip, mac, name, dorm, mask, community ] = value.split(':');
  return {
    'ip': ip,
    'mac': mac,
    'name': name,
    'dorm': dorm,
    'mask': mask,
    'community': community
  };
}

const findSwitches = (dorm, giaddr) => {
  const findOptions = {
    'attributes': ['ip', 'community', 'uplink', 'subnet'],
    'where': {
      'dorm': dorm,
      'level': -1
    }
  };

  if (giaddr) {
    findOptions.where.ip = giaddr.join('.');
  }

  return SwitchList.findAll(findOptions);
};

const getPortIndex = (switchList, chaddr) => {
  const findPort = Promise.all( switchList.map(e => getMACPortIndex(e.ip, e.community, chaddr)) );
  return findPort.then(portIndex => {
    let whichSwitch;
    for (whichSwitch = 0; whichSwitch < portIndex.length; ++whichSwitch) {
      if (portIndex[whichSwitch] !== switchList[whichSwitch].uplink) break;
    }
    return Promise.resolve([switchList[whichSwitch], portIndex[whichSwitch]]);
  });
};

const getSwitchPort = (switchInfo, portIndex) => {
  return switchInfo.getSwitchPort({
    'attributes': ['dorm', 'room', 'plug'],
    'where': { 'port': portIndex },
    'raw': true
  });
};

const getIp = data => {
  if (data.length === 0) {
    return Promise.reject(`cannot find switch port`);
  }

  const dvo = `${data[0].dorm}${data[0].room}-${data[0].plug}`;
  return sql.query('SELECT `ip`, `dvo` FROM `ip_dvo` WHERE `dvo`=? OR `dvo`=? ORDER BY `dvo` DESC', {
    'type': sequelize.QueryTypes.SELECT,
    'replacements': [dvo, `${data[0].dorm}-gateway`]
  }).then(data => {
    if (data.length < 2) return Promise.reject(`cannot find ip of ${dvo}`);

    const userIp = data.filter(e => e.dvo === dvo)[0];
    const gateway = data.filter(e => e.dvo.match(/gateway/))[0];
    if (!userIp || !gateway) return Promise.reject(`cannot find ip of ${dvo}`);

    return Promise.resolve({'user': userIp.ip, 'gateway': gateway.ip});
  });
};

const generateResponse = (ip, gateway, mask, lease, nameServers) => {
  const responseObject = {};
  responseObject.yiaddr = ip;
  responseObject.router = gateway;
  responseObject.subnet_mask = mask;
  responseObject.ip_address_lease_time = lease;

  const resNS = nameServers.map( e => e.split('.').map(e => parseInt(e, 10)) ).reduce((p, c) => p.concat(c));
  responseObject.name_server = resNS;

  return responseObject;
};

const retrieveDHCPOptions = req => {
  const switchList = findSwitches(req.params.dorm, req.body.giaddr);
  const portIndex = switchList.then( data => getPortIndex(data, req.body.chaddr) );
  const switchPort = portIndex.then( data => getSwitchPort(data[0], data[1]) );
  const ip = switchPort.then(getIp);

  return Promise.all([ portIndex, ip ]).then(data => {
    const maskDecimal = parseInt(data[0][0].subnet.split('/')[1], 10);
    const maskBinary = Array(maskDecimal).fill('1').concat(Array(32-maskDecimal).fill('0'));
    const maskDotted = maskBinary.join('').match(/\d{8}/g).map(e => parseInt(e, 2)).join('.');
    const userIp = data[1].user;
    const gateway = data[1].gateway;
    const lease = 14400; // 4 hours

    const resObj = generateResponse(userIp, gateway, maskDotted, lease);

    return Promise.resolve(resObj);
  });
};

const getUserIpWithOption82 = function (giaddr, chaddr, option82) {
  const redisKey = `${giaddr.join('.')}:info`;
  return Promise.all([ Promise.resolve(redisKey), redis.get(redisKey) ])
    .then(data => {
      const [key, bbInfoRaw] = data;
      if (!bbInfoRaw) return Promise.reject(`redis "${key}" not found`);

      const bbInfo = decodeSwitchInfo(bbInfoRaw);
      const relayInfo = extractOption82(bbInfo.name, option82);

      console.log(`dhcp: bb info: ${JSON.stringify(bbInfo)}, relay info: ${JSON.stringify(relayInfo)}`);

      const redisKey = `${bbInfo.ip}:${relayInfo.port}`;
      return Promise.all([ Promise.resolve(redisKey), redis.get(redisKey), chaddr ]);
    })
    .then(data => {
      const [key, edgeRaw, chaddr ] = data;
      if (!edgeRaw) return Promise.reject(`redis "${key}" not found`);

      const edge = decodeSwitchInfo(edgeRaw);

      console.log(`dhcp: edge info: ${JSON.stringify(edge)}, chaddr: ${JSON.stringify(chaddr)}`);

      return Promise.all([ Promise.resolve(edge), getMACPortIndex(edge.ip, edge.community, chaddr) ]);
    })
    .then(data => {
      const [ edge, portIndex ] = data;

      console.log(`dhcp: edge info: ${JSON.stringify(edge)}, port index: ${JSON.stringify(portIndex)}`);

      return Promise.all([ Promise.resolve(edge), getUserIpBySwitchPort(edge.ip, portIndex) ]);
    })
    .then(data => {
      const [ edge, userIp ] = data;

      console.log(`dhcp: edge info: ${JSON.stringify(edge)}, user ip: ${JSON.stringify(userIp)}`);

      return Promise.resolve( generateResponse(userIp.ip, userIp.gateway, edge.mask, globalLease, globalNameServers) );
    });
};

router.post('/discover', function (req, res, next) {
  const notFound = () => {
    res
      .set('Content-Type', 'Application/json')
      .status(404)
      .send('{}')
      .end();
  }
  if (!req.body.giaddr || !req.body.options['82']) {
    return notFound();
  }

  getUserIpWithOption82(req.body.giaddr, req.body.chaddr, req.body.options['82'])
    .then(resObj => {

      console.log(`dhcp: response: ${JSON.stringify(resObj)}`);

      res
        .set('Content-Type', 'Application/json')
        .status(200)
        .send(JSON.stringify(resObj))
        .end();
    })
    .catch(err => {

      console.log(err);

      res
        .set('Content-Type', 'Application/json')
        .status(200)
        .send(`{
          "yiaddr": "140.117.1.1",
          "router": "140.117.1.2",
          "subnet_mask": "255.255.255.0",
          "ip_address_lease_time": 1
        }`)
        .end();

      return;
    });
});

router.post('/request', function (req, res, next) {
  if (!req.body.giaddr) {
    res
      .set('Content-Type', 'Application/json')
      .status(404)
      .send('{}')
      .end();
  }

  if (req.body.options['50'].join('.') === '140.117.1.1') {
      res
        .set('Content-Type', 'Application/json')
        .status(200)
        .send(`{
          "yiaddr": "140.117.1.1",
          "router": "140.117.1.2",
          "subnet_mask": "255.255.255.0",
          "ip_address_lease_time": 1
        }`)
        .end();
        return;
  }


  getUserIpWithOption82(req.body.giaddr, req.body.chaddr, req.body.options['82'])
    .then(resObj => {
      if (req.body.options['50'].join('.') !== resObj.yiaddr) {

        console.log(`dhcp: requested ip: ${req.body.options['50'].join('.')}, correct ip: ${resObj.yiaddr}`)

        res
          .set('Content-Type', 'Application/json')
          .status(403)
          .send(JSON.stringify({ 'requested_ip_address': req.body.options['50'].join('.') }))
          .end();

          return;
      }
      else {
        resObj['requested_ip_address'] = resObj.yiaddr;
      }

      res
        .set('Content-Type', 'Application/json')
        .status(200)
        .send(JSON.stringify(resObj))
        .end();
    })
    .catch(err => {

      console.log(err);

      res
        .set('Content-Type', 'Application/json')
        .status(500)
        .send('{}')
        .end();

      return;
    });
});

router.post('/:dorm/discover', function(req, res, next) {
  const respond = resObj => {
    res
      .set('Content-Type', 'Application/json')
      .status(200)
      .send(JSON.stringify(resObj))
      .end();
  };

  retrieveDHCPOptions(req)
    .then(respond)
    .catch(err => {
      console.log(err);
      res
        .set('Content-Type', 'Application/json')
        .status(500)
        .send('{}')
        .end();

      return;
    });
});

router.post('/:dorm/request', function(req, res, next) {
  const respond = resObj => {
    res
      .set('Content-Type', 'Application/json')
      .status(200)
      .send(JSON.stringify(resObj))
      .end();
  };

  retrieveDHCPOptions(req)
    .then(respond)
    .catch(err => {
      console.log(err);
      res
        .set('Content-Type', 'Application/json')
        .status(500)
        .send('{}')
        .end();

      return;
    });
});

module.exports = router;
