const express = require('express');
const sequelize = require('sequelize');

const SwitchList = require('../../models/switch-list');
const sql = require('../../models/sql');
const { getMACPortIndex } = require('../../models/switch-snmp');

const router = express.Router();

router.post('/:dorm/discover', function(req, res, next) {

  const findSwitches = () => {
    return SwitchList.findAll({
      'attributes': ['ip', 'community', 'uplink', 'subnet'],
      'where': {
        'dorm': req.params.dorm,
        'level': -1
      }
    });
  };

  const getPortIndex = switchList => {
    const findPort = Promise.all( switchList.map(e => getMACPortIndex(e.ip, e.community, req.body.chaddr)) );
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

  const fillResponse = (ip, gateway, mask, lease) => {
    const responseObject = {};
    responseObject.yiaddr = ip;
    responseObject.subnet_mask = mask;
    responseObject.router = gateway;
    responseObject.ip_address_lease_time = lease;
    return responseObject;
  };

  const respond = resObj => {
    res
      .set('Content-Type', 'Application/json')
      .status(200)
      .send(JSON.stringify(resObj))
      .end();
  };

  const switchList = findSwitches();
  const portIndex = switchList.then(getPortIndex);
  const switchPort = portIndex.then( data => getSwitchPort(data[0], data[1]) );
  const ip = switchPort.then(getIp);

  Promise.all([portIndex, ip]).then(data => {
    const maskDecimal = parseInt(data[0][0].subnet.split('/')[1], 10);
    const maskBinary = Array(maskDecimal).fill('1').concat(Array(32-maskDecimal).fill('0'));
    const maskDotted = maskBinary.join('').match(/\d{8}/g).map(e => parseInt(e, 2)).join('.');
    const userIp = data[1].user;
    const gateway = data[1].gateway;
    const lease = 14400; // 4 hours

    const resObj = fillResponse(userIp, gateway, maskDotted, lease);

    respond(resObj);
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

router.post('/:dorm/request', function(req, res, next) {

  const findSwitches = () => {
    return SwitchList.findAll({
      'attributes': ['ip', 'community', 'uplink', 'subnet'],
      'where': {
        'dorm': req.params.dorm,
        'level': -1
      }
    });
  };

  const getPortIndex = switchList => {
    const findPort = Promise.all( switchList.map(e => getMACPortIndex(e.ip, e.community, req.body.chaddr)) );
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

  const fillResponse = (ip, gateway, mask, lease) => {
    const responseObject = {};
    responseObject.yiaddr = ip;
    responseObject.subnet_mask = mask;
    responseObject.router = gateway;
    responseObject.ip_address_lease_time = lease;
    return responseObject;
  };

  const respond = resObj => {
    res
      .set('Content-Type', 'Application/json')
      .status(200)
      .send(JSON.stringify(resObj))
      .end();
  };

  const switchList = findSwitches();
  const portIndex = switchList.then(getPortIndex);
  const switchPort = portIndex.then( data => getSwitchPort(data[0], data[1]) );
  const ip = switchPort.then(getIp);

  Promise.all([portIndex, ip]).then(data => {
    const maskDecimal = parseInt(data[0][0].subnet.split('/')[1], 10);
    const maskBinary = Array(maskDecimal).fill('1').concat(Array(32-maskDecimal).fill('0'));
    const maskDotted = maskBinary.join('').match(/\d{8}/g).map(e => parseInt(e, 2)).join('.');
    const userIp = data[1].user;
    const gateway = data[1].gateway;
    const lease = 14400; // 4 hours

    const resObj = fillResponse(userIp, gateway, maskDotted, lease);

    respond(resObj);
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

module.exports = router;
