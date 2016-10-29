module.exports = {
  'match': /^ProCurve/,
  'extract': agentInformation => {
    return {
      'port': agentInformation['1'][0]
    };
  }
}
