exports.macToDecimal = mac => {
  return mac.match(/../g).map(e => parseInt(e, 16));
};

exports.decimalToMac = decimal => {
  return decimal.map(e => e.toString(16)).join('');
};

