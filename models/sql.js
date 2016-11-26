const config = require('config');
const Sequelize = require('sequelize');
const mysql = require('mysql');
/*
const pool = mysql.createPool({
  'host': config.get('sql.host'),
  'user': config.get('sql.user'),
  'port': config.get('sql.port'),
  'password': config.get('sql.password'),
  'database': config.get('sql.database')
});

exports.pool = pool;
*/
const sql = new Sequelize(
  config.get('sql.database'),
  config.get('sql.user'),
  config.get('sql.password'),
  {
    'host': config.get('sql.host'),
    'dialect': 'mysql',
    'pool': {
      'max': 10,
      'min': 0
    },
    'logging': false
  }
);

module.exports = sql;
