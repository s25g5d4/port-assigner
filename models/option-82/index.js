const vendor = require('./vendor.json');

const switchTypeList = [];

vendor.forEach(e => switchTypeList.push(require(`${__dirname}/${e}`)) );

module.exports.extractOption82 = function extractOption82(switchType, option82) {
  const matchedRule = switchTypeList.filter(e => e.match.test(switchType));
  if (matchedRule.length === 0) {
    return null;
  }
  else {
    let rawOptions = Array.from(option82);
    const rawSubOptions = [];
    while (rawOptions.length !== 0) {
      rawSubOptions.push(rawOptions.slice(0, rawOptions[1] + 2));
      rawOptions.splice(0, rawOptions[1] + 2);
    }

    const subOptions = {};
    rawSubOptions.forEach(e => {
      switch (e[0]) {
      case 1:
        subOptions.CircuitID = e.slice(2, e[1] + 2);
        subOptions[e[0]] = subOptions.CircuitID;
        break;

      case 2:
        subOptions.RemoteID = e.slice(2, e[1] + 2);
        subOptions[e[0]] = subOptions.RemoteID;
        break;

      default:
        subOptions[e[0]] = e.slice(2, e[1] + 2);
      }

    });

    return matchedRule[0].extract(subOptions);
  }
}
