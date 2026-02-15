const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return error after 2 seconds if connection cannot be established
  maxUses: 7500, // Close connections after 7500 queries
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
  process.exit(-1); // Exit on critical database errors
});

pool.on('connect', () => {
  console.log('Database connection established');
});

pool.on('remove', () => {
  console.log('Database client removed from pool');
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
