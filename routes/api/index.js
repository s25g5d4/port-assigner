var express = require('express');
var router = express.Router();

var dhcp = require('./dhcp');

router.use('/dhcp', dhcp);

module.exports = router;
