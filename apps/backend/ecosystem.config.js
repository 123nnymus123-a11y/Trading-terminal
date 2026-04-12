module.exports = {
  apps: [
    {
      // Application name
      name: 'trading-terminal-backend',
      
      // Script to run
      script: 'pnpm',
      args: 'start',
      
      // Execution mode
      exec_mode: 'cluster',
      
      // Number of instances (use 'max' for all CPU cores)
      instances: 'max',
      
      // Environment variables
      env: {
        NODE_ENV: 'production',
        PORT: 8787,
      },
      
      // Restart policy
      restart_delay: 4000,                    // Delay before restart (ms)
      max_restarts: 10,                       // Max restarts in max_restarts_window
      min_uptime: '10s',                      // Minimum uptime before restart resets counter
      max_memory_restart: '500M',             // Restart if exceeds 500MB
      
      // Logging
      output: '/var/log/pm2/trading-terminal-backend-out.log',
      error: '/var/log/pm2/trading-terminal-backend-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Watch mode (watch files and auto-restart on changes)
      watch: false,                           // Set to true in development
      ignore_watch: ['node_modules', 'dist', '.git'],
      
      // Graceful shutdown
      kill_timeout: 5000,                     // Time to wait for graceful shutdown (ms)
      listen_timeout: 10000,                  // Time to wait for app to start listening
      
      // Advanced settings
      autorestart: true,
      max_old_space_size: 512,                // Node.js heap size (MB)
      
      // Merge logs from all instances
      merge_logs: true,
    }
  ],
  
  // Deploy configuration (optional)
  deploy: {
    production: {
      user: 'ubuntu',
      host: 'api.example.com',
      ref: 'origin/main',
      repo: 'git@github.com:your-org/TradingTerminal-SourceCode.git',
      path: '/opt/trading-terminal',
      'post-deploy': 'pnpm install && pnpm -C apps/backend build && pm2 restart trading-terminal-backend',
      'pre-deploy-local': 'echo "Deploying to production"'
    }
  }
};
