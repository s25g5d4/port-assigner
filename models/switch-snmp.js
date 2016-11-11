const snmp = require('net-snmp');

const dot1dBasePortIfIndex = '1.3.6.1.2.1.17.1.4.1.2';
const dot1qVlanStaticName = '1.3.6.1.2.1.17.7.1.4.3.1.1';
const dot1qTpFdbPort = '1.3.6.1.2.1.17.7.1.2.2.1.2';
const dot1dTpFdbPort = '1.3.6.1.2.1.17.4.3.1.2';
const snmpOptions = {
  'version': snmp.Version2c
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

        session.get([`${dot1dTpFdbPort}.${mac.join('.')}`], doneCallback);
      });
    };

    const dot1qFindPort = function dot1qFindPort() {
      const session = snmp.createSession(switchIp, community, snmpOptions);
      return getVlanIndex(switchIp, community).then(vlans => {

        const findPort = function findPort(vlan) {
          return new Promise(function (resolve, reject) {
            const doneCallback = function doneCallback(err, varbinds) {
              if (err) return reject(err);
              session.close();

              if (snmp.isVarbindError(varbinds[0])) return reject(snmp.varbindError(varbinds[0]));
              else return resolve(varbinds[0].value);
            };

            session.get([`${dot1qTpFdbPort}.${vlan.id}.${mac.join('.')}`], doneCallback);
          });
        }

        return Promise.all(vlans.map(findPort)).then(varbinds => {
          const result = varbinds.filter(e => !snmp.isVarbindError(e));
          if (result.length === 0) {
            return Promise.reject({
              'type': 'snmp not found',
              'data': {
                'what': 'port index',
                'mac': mac.map(e => `0${e.toString(16)}`.slice(-2)).join('')
              },
              'message': `cannot find port index of ${mac.map(e => `0${e.toString(16)}`.slice(-2)).join('')}`
            });
          }
          else {
            return Promise.resolve(result[0].value);
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

exports.getSwitchPortIndex = getSwitchPortIndex;
exports.getVlanIndex = getVlanIndex;
exports.getMACPortIndex = getMACPortIndex;
