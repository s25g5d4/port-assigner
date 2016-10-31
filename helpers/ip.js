exports.decimalToDottedIp = e => {
  return e.map(e => toString(10)).join('.');
};

exports.cidrToDottedMask = cidr => {
  const subnetDotted = [];
  while (cidr >= 8) {
    subnetDotted.push(255);
    cidr -= 8;
  }
  subnetDotted.push( (0xff << (8 - cidr) & 0xff) );
  while (4 - subnetDotted.length) {
    subnetDotted.push(0);
  }
};

exports.isZero = ip => {
  if (typeof ip === 'string') return !!ip.trim().match(/^0\.0\.0\.0$/);
  else if (ip.every) return ip.every(e => e === 0);
};