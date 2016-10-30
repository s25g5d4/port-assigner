module.exports = {
  'match': /^ProCurve/,
  'extract': agentInformation => {
    return {
      'port': agentInformation.CircuitID[0]
    };
  }
}
