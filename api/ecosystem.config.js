module.exports = {
    apps: [
      {
        name: 'ai-agent-api',
        script: 'app.js',
        instances: 1, // Or 'max' to use all CPU cores
        autorestart: true,
        watch: false, // Set to true to automatically restart on file changes during development
        max_memory_restart: '1G',
        env: {
          NODE_ENV: 'development',
          // You can also include your environment variables here
          OPENAI_API_KEY: process.env.OPENAI_API_KEY,
          SERPER_API_KEY: process.env.SERPER_API_KEY,
          REALTIME_SESSION_URL: process.env.REALTIME_SESSION_URL,
        },
        env_production: {
          NODE_ENV: 'production',
          // Production-specific environment variables
        },
      },
      // You can define more applications here if needed
    ],
  };