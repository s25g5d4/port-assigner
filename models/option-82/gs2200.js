module.exports = {
  'match': /^GS2200/,
  'extract': agentInformation => {
    return {
      'slot': agentInformation['1'][0],
      'port': agentInformation['1'][1],
      'vlan': agentInformation['1'][2],
      'extraInfo': agentInformation['1'].slice(3)
    };
  }
}
