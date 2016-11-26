const express = require('express');
const SwitchList = require('../models/switch-list');
const IpDvo = require('../models/ip-dvo');

const router = express.Router();

const ipMatch = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

router.get('/:ip', function (req, res, next) {
  if (!ipMatch.test(req.params.ip)) return next();

  SwitchList.findOne({
    'attributes': ['ip', 'mac', 'name', 'uptime', 'full', 'level'],
    'where': { 'ip': req.params.ip }
  })
    .then(switchInfo => {
      if (!switchInfo) return next();

      switchInfo.getSwitchPort({ 'order': 'CONVERT(`port`, UNSIGNED INTEGER)', 'raw': true })
        .then(switchPort => {
          const selectedDvo = switchPort
            .filter(e => e.dorm && e.room && e.plug)
            .map(e => ({ 'dvo': `${e.dorm}${e.room}-${e.plug}` }) );

          return Promise.all([ Promise.resolve(switchPort), IpDvo.findAll({ 'where': { '$or': selectedDvo }, 'raw': true }) ]);
        })
        .then(([switchPort, ipDvo]) => {
          const switchType = [
            { test: modelName => /^ProCurve.*Switch 2626$/.test(modelName), 'type': 'hp-2626'      },
            { test: modelName => /^ProCurve.*Switch 2610$/.test(modelName), 'type': 'hp-2610'      },
            { test: modelName => /^GS2200-24$/.test(modelName),             'type': 'zyxel-gs2200' }
          ];

          const matchedSwitch = switchType.filter(e => e.test(switchInfo.name));
          if (!matchedSwitch.length) return next();

          switchPort
            .filter(e => e.dorm && e.room && e.plug)
            .map(e => ({ 'port': e.port, 'dvo':`${e.dorm}${e.room}-${e.plug}` }))
            .forEach(portInfo => {
              const targetDvo = ipDvo.find(dvoInfo => dvoInfo.dvo === portInfo.dvo);
              if (!targetDvo) return;

              targetDvo.port = portInfo.port;
            });

          res.render(`switch/${matchedSwitch[0].type}`, {
            'title': `Edge Switch ${req.params.ip}`,
            'switchInfo': switchInfo.get({ 'plain': true }),
            'switchPort': switchPort,
            'ipDvo': ipDvo
          });

        });

    });

});

module.exports = router;
