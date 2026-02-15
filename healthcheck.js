#!/usr/bin/env node
/**
 * Health check script for APEP Election System
 * Tests API endpoints and database connectivity
 */

const https = require('https');
const { Pool } = require('pg');

const BASE_URL = process.env.DOMAIN || 'apep.fun';
const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/agent_elections';

let exitCode = 0;

// Test API health endpoint
function testAPI() {
  return new Promise((resolve) => {
    https.get(`https://${BASE_URL}/api/health`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.status === 'ok') {
            console.log('✓ API health check passed');
            resolve(true);
          } else {
            console.error('✗ API health check failed:', json);
            exitCode = 1;
            resolve(false);
          }
        } catch (err) {
          console.error('✗ API health check error:', err.message);
          exitCode = 1;
          resolve(false);
        }
      });
    }).on('error', (err) => {
      console.error('✗ API connection error:', err.message);
      exitCode = 1;
      resolve(false);
    });
  });
}

// Test database connectivity
async function testDatabase() {
  const pool = new Pool({ connectionString: DB_URL });
  try {
    const result = await pool.query('SELECT NOW() as time, COUNT(*) as agents FROM registered_agents');
    console.log('✓ Database connection OK -', result.rows[0].agents, 'registered agents');
    await pool.end();
    return true;
  } catch (err) {
    console.error('✗ Database connection failed:', err.message);
    exitCode = 1;
    await pool.end();
    return false;
  }
}

// Test election status endpoint
function testElectionStatus() {
  return new Promise((resolve) => {
    https.get(`https://${BASE_URL}/api/election/status`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.active_election !== undefined) {
            console.log('✓ Election status endpoint working');
            resolve(true);
          } else {
            console.error('✗ Election status returned unexpected data');
            exitCode = 1;
            resolve(false);
          }
        } catch (err) {
          console.error('✗ Election status parse error:', err.message);
          exitCode = 1;
          resolve(false);
        }
      });
    }).on('error', (err) => {
      console.error('✗ Election status connection error:', err.message);
      exitCode = 1;
      resolve(false);
    });
  });
}

// Run all checks
async function runHealthCheck() {
  console.log('APEP Health Check - ' + new Date().toISOString());
  console.log('='.repeat(50));
  
  await testAPI();
  await testDatabase();
  await testElectionStatus();
  
  console.log('='.repeat(50));
  if (exitCode === 0) {
    console.log('✓ All health checks passed');
  } else {
    console.log('✗ Health check failed - exit code', exitCode);
  }
  
  process.exit(exitCode);
}

runHealthCheck();
