var express = require('express');
var router = express.Router();

var api = require('./api');
var edit = require('./edit');

const SwitchList = require('../models/switch-list');

/* GET home page. */
router.get('/', function(req, res, next) {

  SwitchList.findAll({
    'attributes': ['ip', 'name', 'uptime', 'full', 'level'],
    'where': {
      'level': { $ne: 0 }
    }
  }).then(list => {
    list = list.map(e => e.get({ 'plain': true }));
    res.render('index', { title: 'Express', 'list': list });
  });

});

router.use('/edit', edit);

router.use('/api', api);

module.exports = router;
