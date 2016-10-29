const config = require('config');
const sequelize = require('sequelize');
const mysql = require('mysql');

const sql = require('./sql');

const IpDvo = config.get('sql.tables.IpDvo');
const SwitchDvo = config.get('sql.tables.SwitchDvo');

module.exports.getUserIpBySwitchPort = function getUserIpBySwitchPort(switchIp, switchPort) {
  return sql.query(
    mysql.format(`
      SELECT ??.\`ip\`, ??.\`dvo\`
      FROM ??, ??
      WHERE ??.\`ip\` = ?
            AND ??.\`port\` = ?
            AND (
              ??.\`dvo\` = CONCAT(??.\`dorm\`, ??.\`room\`, '-', ??.\`plug\`)
              OR ??.\`dvo\` = CONCAT(??.\`dorm\`, '-gateway')
            )
    `, [
      /* SELECT */   IpDvo, IpDvo,
      /* FROM */     IpDvo, SwitchDvo,
      /* WHERE */    SwitchDvo, switchIp,
                     SwitchDvo, switchPort,
                     IpDvo, SwitchDvo, SwitchDvo, SwitchDvo,
                     IpDvo, SwitchDvo
    ]), {
    'type': sequelize.QueryTypes.SELECT
  })
    .then(data => {
      if (data.length !== 2) return Promise.reject(`User IP of ${switchIp}:${switchPort} not found`);

      let ip, gateway;
      if (data[0].dvo.search('gateway') >= 0) {
        gateway = data[0].ip;
        ip = data[1].ip;
      }
      else {
        gateway = data[1].ip;
        ip = data[0].ip;
      }

      return Promise.resolve({ 'ip': ip, 'gateway': gateway });
    });
}