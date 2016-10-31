exports.decodeSwitchInfo = value => {
  const [ ip, mac, name, dorm, mask, community ] = value.split(':');
  return {
    'ip': ip,
    'mac': mac,
    'name': name,
    'dorm': dorm,
    'mask': mask,
    'community': community
  };
};

exports.encodeSwitchInfo = e => {
  let subnetDecimal = parseInt(e.subnet.split('/')[1], 10);
  const subnetDotted = [];
  while (subnetDecimal >= 8) {
    subnetDotted.push(255);
    subnetDecimal -= 8;
  }
  subnetDotted.push( (0xff << (8 - subnetDecimal) & 0xff) );
  while (4 - subnetDotted.length) {
    subnetDotted.push(0);
  }
  return `${e.ip}:${e.mac}:${e.name}:${e.dorm}:${subnetDotted.join('.')}:${e.community}`
};
