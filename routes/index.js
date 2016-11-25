var express = require('express');
var router = express.Router();

var api = require('./api');
var view = require('./view');

const SwitchList = require('../models/switch-list');

/* GET home page. */
router.get('/', function(req, res, next) {

  SwitchList.findAll({
    'attributes': ['ip', 'name', 'uptime', 'full', 'level'],
    'where': {
      'level': { $ne: 0 }
    },
    'order': 'full,dorm,ip'
  }).then(list => {
    list = list.map(e => e.get({ 'plain': true }));
    res.render('index', { title: 'Port-Assigner', 'list': list });
  });

});

router.use('/view', view);

router.use('/api', api);

module.exports = router;
