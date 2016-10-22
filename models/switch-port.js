const config = require('config');
const Sequelize = require('sequelize');

const sql = require('./sql');

const SwitchPort = sql.define('SwitchPort', {
  'ip':      { 'type': Sequelize.STRING(80), 'allowNull': false, 'primaryKey': true, 'validate': { 'isIPv4': true } },
  'port':    { 'type': Sequelize.STRING(3),  'allowNull': false, 'primaryKey': true },
  'dorm':    { 'type': Sequelize.CHAR(1),    'allowNull': false  },
  'room':    { 'type': Sequelize.STRING(4),  'allowNull': false  },
  'plug':    { 'type': Sequelize.CHAR(1),    'allowNull': false  },
  'special': { 'type': Sequelize.CHAR(1),    'allowNull': false, 'defaultValue': '0'  },
}, {
  'timestamps': false,
  'underscored': true,
  'freezeTableName': true,
  'tableName': config.get('sql.tables.SwitchPort')
});

module.exports = SwitchPort;
