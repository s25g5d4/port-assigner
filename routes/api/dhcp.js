const express = require('express');
const sequelize = require('sequelize');

const SwitchList = require('../../models/switch-list');
const sql = require('../../models/sql');
const { getMACPortIndex } = require('../../models/switch-snmp');

const router = express.Router();

router.post('/discover', function(req, res, next) {
  if (req.body.giaddr.join('.') === '0.0.0.0') {
    res
      .set('Content-Type', 'Application/json')
      .status(403)
      .send('{}')
      .end();

    return;
  }

  SwitchList.findById(req.body.giaddr.join('.'), { 'attributes': ['ip', 'community'] })
    .then(switchInfo => {
      return Promise.all([
        Promise.resolve(switchInfo),
        getMACPortIndex(switchInfo.ip, switchInfo.community, req.body.chaddr)
      ]);
    })
    .then(data => {
      return data[0].getSwitchPort({
        'attributes': ['dorm', 'room', 'plug'],
        'where': {
          'port': data[1]
        },
        'raw': true
      });
    })
    .then(data => {
      const dvo = `${data[0].dorm}${data[0].room}-${data[0].plug}`;
      return sql.query('SELECT `ip` FROM `ip_dvo` WHERE `dvo`=?', { 'type': sequelize.QueryTypes.SELECT, 'replacements': [dvo] });
    })
    .then(clientIp => {
      const octetIp = clientIp[0].ip.split('.').map(e => parseInt(e, 10));
      const resObj = JSON.parse(JSON.stringify(req.body));
      resObj.yiaddr = octetIp;
      return Promise.resolve(resObj);
    })
    .then(resObj => {
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

router.post('/request', function(req, res, next) {
  const log = require('fs').createWriteStream(Date.now() + '.log');
  log.write(JSON.stringify(req.body, undefined, 2));

  getMACPortIndex(req.body.giaddr.join('.'), 'stiks', req.body.chaddr).then(data => console.log(data)).catch(err => console.log(err));

  res
    .set('Content-Type', 'Application/json')
    .status(403)
    .send('{}')
    .end();
});

module.exports = router;
