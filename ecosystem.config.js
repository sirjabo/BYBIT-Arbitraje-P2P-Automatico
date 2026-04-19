// ecosystem.config.js
// PM2 process manager configuration for production deployment.
// Usage: pm2 start ecosystem.config.js

module.exports = {
  apps: [
    {
      name: 'bybit-p2p-bot',
      script: './backend/src/index.js',
      cwd: '/opt/bybit-p2p-bot',

      // Restart policy
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      min_uptime: '10s',

      // Resource limits
      max_memory_restart: '300M',

      // Environment
      env: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
      },

      // Logging
      error_file: '/var/log/bybit-p2p-bot/error.log',
      out_file: '/var/log/bybit-p2p-bot/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,

      // Crash handling: exponential backoff
      exp_backoff_restart_delay: 100,
    },
  ],
};
