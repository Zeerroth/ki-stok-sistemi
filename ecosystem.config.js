// PM2 yapilandirmasi - VPS'te surekli calistirmak icin
// Kullanim: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'ki-stok',
      script: 'server.js',
      node_args: '--disable-warning=ExperimentalWarning',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
