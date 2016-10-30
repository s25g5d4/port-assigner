module.exports = {
  'match': /^GS2200/,
  'extract': agentInformation => {
    return {
      'slot': agentInformation.CircuitID[0],
      'port': agentInformation.CircuitID[1],
      'vlan': agentInformation.CircuitID[2],
      'extraInfo': agentInformation.CircuitID.slice(3)
    };
  }
}
