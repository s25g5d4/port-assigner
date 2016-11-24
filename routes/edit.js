const express = require('express');
const SwitchList = require('../models/switch-list');

const router = express.Router();

const ipMatch = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

router.get('/:ip', function (req, res, next) {
  if (!ipMatch.test(req.params.ip)) return next();

  SwitchList.findOne({
    'attributes': ['ip', 'name', 'uptime', 'full', 'level'],
    'where': { 'ip': req.params.ip }
  }).then(switchInfo => {
    if (!switchInfo) return next();

    switchInfo.getSwitchPort({ 'raw': true }).then(switchPort => {
      switchPort.sort( (a, b) => parseInt(a.port, 10) - parseInt(b.port, 10) );

      res.render('view', {
        'title': `View ${req.params.ip}`,
        'switchInfo': switchInfo.get({ 'plain': true }),
        'switchPort': switchPort
      });

    });
  });
});

module.exports = router;
