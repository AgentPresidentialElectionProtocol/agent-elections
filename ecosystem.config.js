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
    max_memory_restart: '200M',
  }],
};
