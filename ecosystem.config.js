module.exports = {
  apps: [{
    name: 'agent-elections',
    script: 'server.js',
    cwd: '/root/agent-elections',
    env: {
      NODE_ENV: 'production',
      PORT: 3100,
      HOST: '0.0.0.0',
    },
    watch: false,
    max_memory_restart: '300M',
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 4000,
    autorestart: true,
    error_file: '/root/.pm2/logs/agent-elections-error.log',
    out_file: '/root/.pm2/logs/agent-elections-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    kill_timeout: 5000,
  }],
};
