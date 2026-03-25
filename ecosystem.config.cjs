module.exports = {
  apps: [
    {
      name: 'polybot-paper',
      script: 'npx',
      args: 'tsx src/paper-trader.ts',
      cwd: '/Users/edorfanini/Desktop/Prediction market bot',
      autorestart: true,
      max_restarts: 50,
      restart_delay: 5000,
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'polybot-live',
      script: 'npx',
      args: 'tsx src/index.ts',
      cwd: '/Users/edorfanini/Desktop/Prediction market bot',
      autorestart: true,
      max_restarts: 50,
      restart_delay: 5000,
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
