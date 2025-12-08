const env = (() => {
  try {
    require.resolve('gas-jest');
    return 'gas-jest';
  } catch (e) {
    return 'node';
  }
})();

module.exports = {
  testEnvironment: env,
};
