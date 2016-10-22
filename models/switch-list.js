const config = require('config');
const Sequelize = require('sequelize');

const sql = require('./sql');
const SwitchPort = require('./switch-port');

const SwitchList = sql.define('SwitchList', {
  'ip':         { 'type': Sequelize.STRING(80),  'allowNull': false, 'primaryKey': true, 'validate': { 'isIPv4': true } },
  'mac':        { 'type': Sequelize.STRING(12),  'allowNull': false  },
  'name':       { 'type': Sequelize.STRING(50),  'allowNull': false  },
  'uptime':     { 'type': Sequelize.STRING(45),  'allowNull': false  },
  'dorm':       { 'type': Sequelize.CHAR(1),     'allowNull': false  },
  'full':       { 'type': Sequelize.STRING(100), 'allowNull': false  },
  'subnet':     { 'type': Sequelize.STRING(100), 'allowNull': false  },
  'level':      { 'type': Sequelize.INTEGER,     'allowNull': false, 'defaultValue': 0 },
  'community':  { 'type': Sequelize.STRING(25),  'allowNull': false  },
  'uplink':     { 'type': Sequelize.INTEGER,     'allowNull': false, 'defaultValue': 0 },
  'serial_no':  { 'type': Sequelize.STRING(14),  'allowNull': false  },
  'product_no': { 'type': Sequelize.STRING(10),  'allowNull': false  },
  'hw_ver':     { 'type': Sequelize.STRING(10),  'allowNull': false  },
  'sw_ver':     { 'type': Sequelize.STRING(10),  'allowNull': true,  'defaultValue': null },
  'fw_ver':     { 'type': Sequelize.STRING(10),  'allowNull': false  },
  'time':       { 'type': Sequelize.DATE,        'allowNull': true,  'defaultValue': null },
  'jail':       { 'type': Sequelize.CHAR(1),     'allowNull': false, 'defaultValue': '0' }
}, {
  'timestamps': false,
  'underscored': true,
  'freezeTableName': true,
  'tableName': config.get('sql.tables.SwitchList')
});

SwitchList.hasMany(SwitchPort, { 'as': 'SwitchPort', 'foreignKey': 'ip' });

module.exports = SwitchList;
