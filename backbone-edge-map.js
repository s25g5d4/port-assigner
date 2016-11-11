const redis = require('./models/redis');
const SwitchList = require('./models/switch-list');
const { getMACPortIndex } = require('./models/switch-snmp');
const { redisValue: { encodeSwitchInfo }, mac: { macToDecimal } } = require('./helpers');

const switchFindOptions = {
  'attributes': ['ip', 'mac', 'name', 'dorm', 'subnet', 'level', 'community'],
  'order': [
    ['dorm', 'ASC'],
    ['level', 'DESC'],
    ['ip', 'ASC']
  ],
  'raw': true
};

const transformList = rows => {
  return Promise.resolve(rows.reduce((p, c) => {
    if (!p[c.dorm]) p[c.dorm] = {};

    if (c.level === -1) {
      if (p[c.dorm].edge) p[c.dorm].edge.push(c);
      else p[c.dorm].edge = [c];
    }
    else if (c.level === 0) {
      if (p[c.dorm].backbone) p[c.dorm].backbone.push(c);
      else p[c.dorm].backbone = [c];
    }
    return p;
  }, {}));
};

const lookupBackbonePort = dormSwitches => {
  const bbList = [];

  for (let dorm in dormSwitches) {
    if (dormSwitches.hasOwnProperty(dorm)) {
      dorm = dormSwitches[dorm];

      if (dorm.backbone && dorm.edge) {
        dorm.backbone.forEach(bb => {
          bbList.push(
            Promise.all(
              dorm.edge.map( edge => getMACPortIndex(bb.ip, bb.community, macToDecimal(edge.mac)).catch( err => Promise.resolve(-1) ) )
            ).then( data => bb.edgePort = data.map( (e, i, a) => ((a.indexOf(e) !== i || a.lastIndexOf(e) !== i) ? -1 : e) ) )
          );
        });
      }

    }
  }

  return Promise.all(bbList).then(() => Promise.resolve(dormSwitches));
};

const writePortMap = dormSwitches => {
  for (let dorm in dormSwitches) {
    if (dormSwitches.hasOwnProperty(dorm)) {
      dorm = dormSwitches[dorm];

      if (dorm.backbone && dorm.edge) {
        dorm.backbone.forEach(bb => {
          dorm.edge.forEach((edge, i) => {
            if (bb.edgePort[i] === -1) return;

            const key = `${bb.ip}:${bb.edgePort[i]}`;
            const value = encodeSwitchInfo(edge);

            redis.set(key, value);
            console.log(`"${key}", "${edge.ip}", "${edge.name}", "${edge.dorm}"`);
          });

          const bbInfoKey = `${bb.ip}:info`;
          const bbValue = encodeSwitchInfo(bb);

          redis.set(bbInfoKey, bbValue);
          console.log(`"${bbInfoKey}", "${bb.ip}", "${bb.name}", "${bb.dorm}"`);
        });
      }

    }
  }

};

let mapDoing = false;

const doBbEdgeMap = () => {
  mapDoint = true;
  console.log(`Start at ${(new Date()).toLocaleString()}`);
  SwitchList.findAll(switchFindOptions)
    .then(transformList)
    .then(lookupBackbonePort)
    .then(writePortMap)
    .then(() => {
      console.log(`Done at ${(new Date()).toLocaleString()}`);
      mapDoing = false;
    })
    .catch(err => {
      console.error(err);
      mapDoing = false;
    });
};

doBbEdgeMap();
setInterval(doBbEdgeMap, 900000);
