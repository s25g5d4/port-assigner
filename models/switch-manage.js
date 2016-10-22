const { pool } = require('./sql');
const table = {
  switchList: 'switch_list',
  switchPortTag: 'switch_dvo'
};

exports.getSwitchList = function getSwitchList(columns) {
  return new Promise(function (resolve, reject) {
    const query = `SELECT ?? FROM \`${table.switchList}\` ORDER BY dorm, full, ip`;

    pool.getConnection(function (err, connection) {
      if (err) return reject(err);

      connection.query(query, [ columns ], (err, rows) => {
        if (err) return reject(err);

        connection.release();
        return resolve(rows);
      });
    });

  });
};

exports.getSwitchPortTag = function getSwitchPortTag(switchIp) {
  return new Promise(function (resolve, reject) {
    const query = `SELECT * FROM \`${table.switchPortTag}\` WHERE ip=? ORDER BY port ASC`;

    pool.getConnection(function (err, connection) {
      if (err) return reject(err);

      connection.query(query, [ switchIp ], (err, rows) => {
        if (err) return reject(err);

        connection.release();
        return resolve(rows);
      });
    });
  });
}
