exports.macToDecimal = mac => {
  return mac.match(/../g).map(e => parseInt(e, 16));
};

exports.decimalToMac = decimal => {
  return decimal.map(e => `0${e.toString(16)}`.slice(-2)).join('');
};

