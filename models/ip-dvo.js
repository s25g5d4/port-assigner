const config = require('config');
const Sequelize = require('sequelize');

const sql = require('./sql');

const IpDvo = sql.define('IpDvo', {
  'ip':     { 'type': Sequelize.STRING(80),   'allowNull': false, 'primaryKey': true,  'validate': { 'isIPv4': true } },
  'dvo':    { 'type': Sequelize.TEXT('tiny'), 'allowNull': true,  'defaultValue': null },
  'status': { 'type': Sequelize.TEXT('tiny'), 'allowNull': false  }
}, {
  'timestamps': false,
  'underscored': true,
  'freezeTableName': true,
  'tableName': config.get('sql.tables.IpDvo')
});

module.exports = IpDvo;
