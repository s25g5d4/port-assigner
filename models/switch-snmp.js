const snmp = require('net-snmp');
const { decimalToMac } = require('../helpers/mac');

const dot1dBasePortIfIndex = '1.3.6.1.2.1.17.1.4.1.2';
const dot1qVlanStaticName = '1.3.6.1.2.1.17.7.1.4.3.1.1';
const dot1qTpFdbPort = '1.3.6.1.2.1.17.7.1.2.2.1.2';
const dot1dTpFdbPort = '1.3.6.1.2.1.17.4.3.1.2';
const ifAdminStatus = '1.3.6.1.2.1.2.2.1.7';
const snmpOptions = {
  'version': snmp.Version2c,
  'timeout': 1000
};

const getSwitchPortIndex = function getSwitchPortIndex(switchIp, community) {
  return new Promise(function (resolve, reject) {
    const session = snmp.createSession(switchIp, community, snmpOptions);

    const baseIndex = [];
    const ifIndex = [];

    const feedCallback = function feedCallback(varbinds) {
      for (let varbind of varbinds) {
        if (snmp.isVarbindError(varbind)) {
          return reject(err);
        }
        else {
          baseIndex.push( parseInt(varbind.oid.split('.').pop(), 10) );
          ifIndex.push(varbind.value);
        }
      }
    };

    const doneCallback = function doneCallback(err) {
      if (err) return reject(err);

      session.close();

      return resolve({ 'baseIndex': baseIndex, 'ifIndex': ifIndex });
    };

    session.subtree(dot1dBasePortIfIndex, feedCallback, doneCallback);
  });
};

const getVlanIndex = function getVlanIndex(switchIp, community) {
  return new Promise(function (resolve, reject) {
    const session = snmp.createSession(switchIp, community, snmpOptions);

    const vlans = [];

    const feedCallback = function feedCallback(varbinds) {
      for (let varbind of varbinds) {
        if (snmp.isVarbindError(varbind)) {
          return reject(err);
        }
        else {
          vlans.push({ 'name': varbind.value, 'id': parseInt(varbind.oid.split('.').pop(), 10) });
        }
      }
    };

    const doneCallback = function doneCallback(err) {
      if (err) return reject(err);

      session.close();

      return resolve(vlans);
    };

    session.subtree(dot1qVlanStaticName, feedCallback, doneCallback);
  });
};

const getMACPortIndex = function getMACPortIndex(switchIp, community, mac) {
  return new Promise(function (resolve, reject) {

    const dot1dFindPort = function dot1dFindPort() {
      const session = snmp.createSession(switchIp, community, snmpOptions);
      return new Promise(function (resolve, reject) {
        const doneCallback = function doneCallback(err, varbinds) {
          if (err) return reject(err);
          session.close();

          if (snmp.isVarbindError(varbinds[0])) return reject(snmp.varbindError(varbinds[0]));
          else return resolve(varbinds[0].value);
        };

        session.get([ `${dot1dTpFdbPort}.${mac.join('.')}` ], doneCallback);
      });
    };

    const dot1qFindPort = function dot1qFindPort() {
      const session = snmp.createSession(switchIp, community, snmpOptions);

      return getVlanIndex(switchIp, community).then(vlans => {
        const findPort = function findPort(vlan) {
          return new Promise(function (resolve, reject) {
            const doneCallback = function doneCallback(err, varbinds) {
              if (err) return reject(err);

              return resolve(varbinds[0]);
            };

            session.get([ `${dot1qTpFdbPort}.${vlan.id}.${mac.join('.')}` ], doneCallback);
          });
        }

        return Promise.all(vlans.map(findPort)).then(varbinds => {
          session.close();
          varbinds = varbinds.filter(e => !snmp.isVarbindError(e));

          if (varbinds.length === 0) {
            return Promise.reject({
              'type': 'snmp not found',
              'data': {
                'what': 'port index',
                'switchIp': switchIp,
                'mac': decimalToMac(mac)
              },
              'message': `cannot find port index of ${decimalToMac(mac)} on ${switchIp}`
            });
          }
          else {
            return Promise.resolve(varbinds[0].value);
          }
        });

      });
    };

    dot1dFindPort()
      .catch(dot1qFindPort)
      .then(resolve)
      .catch(reject);

  });
};

const getAdminStatus = function getAdminStatus(switchIp, community, port) {
  return new Promise(function (resolve, reject) {
    const session = snmp.createSession(switchIp, community, snmpOptions);

    const doneCallback = function doneCallback(err, varbinds) {
      if (err) return reject(err);
      session.close();

      if (snmp.isVarbindError(varbinds[0])) {
        return reject({
              'type': 'snmp not found',
              'data': {
                'what': 'port status',
                'port': port
              },
              'message': `cannot find port status of port ${port} on ${switchIp}`
        });
      }
      else {
        return resolve(varbinds[0].value);
      }
    };

    session.get([ `${ifAdminStatus}.${port}` ], doneCallback);
  });
};

const setAdminStatus = function setAdminStatus(switchIp, community, port, status) {
  return new Promise(function (resolve, reject) {
    const session = snmp.createSession(switchIp, community, snmpOptions);

    const doneCallback = function doneCallback(err, varbinds) {
      if (err) return reject(err);
      session.close();

      if (snmp.isVarbindError(varbinds[0])) {
        return reject({
              'type': 'snmp not found',
              'data': {
                'what': 'port status',
                'port': port,
                'status': status
              },
              'message': `cannot set port status of port ${port} on ${switchIp}`
        });
      }
      else {
        return resolve(varbinds[0].value);
      }
    };

    if (typeof status === 'string') {
      switch (status) {
        case 'up':
          status = 1;
          break;

        case 'down':
          status = 2;
          break;

        case 'testing':
          status = 3;
          break;

        default:
          return reject(new TypeError(`invalid status: ${status}`));
      }
    }
    else {
      if (status !== 1 && status !== 2 && status !== 3) {
        return reject(new TypeError(`invalid status: ${status}`));
      }
    }

    session.set([
      {
        'oid': `${ifAdminStatus}.${port}`,
        'type': snmp.ObjectType.Integer32,
        'value': status
      }
    ], doneCallback);
  });

};

exports.getSwitchPortIndex = getSwitchPortIndex;
exports.getVlanIndex = getVlanIndex;
exports.getMACPortIndex = getMACPortIndex;
exports.getAdminStatus = getAdminStatus;
exports.setAdminStatus = setAdminStatus;