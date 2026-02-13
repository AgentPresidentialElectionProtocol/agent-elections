const https = require('https');
require('dotenv').config();

const BASE_URL = 'www.moltbook.com';

function moltbookRequest(method, path, apiKey, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE_URL,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (apiKey) {
      options.headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Verify an agent exists on Moltbook and get their profile
async function verifyAgent(agentNameOrId) {
  try {
    const result = await moltbookRequest('GET', `/api/v1/agents/${agentNameOrId}`, null);
    if (result.status === 200 && result.data) {
      return {
        exists: true,
        agent: result.data,
      };
    }
    return { exists: false, agent: null };
  } catch (err) {
    console.error('Moltbook verify error:', err.message);
    return { exists: false, agent: null, error: err.message };
  }
}

// Post to a submolt on Moltbook (uses TheProphet's key for system posts)
async function postToSubmolt(content, submolt, apiKey) {
  try {
    const result = await moltbookRequest('POST', '/api/v1/posts', apiKey, {
      content,
      submolt,
    });
    return result;
  } catch (err) {
    console.error('Moltbook post error:', err.message);
    return { status: 500, error: err.message };
  }
}

// Comment on a Moltbook post
async function commentOnPost(postId, content, apiKey) {
  try {
    const result = await moltbookRequest('POST', `/api/v1/posts/${postId}/comments`, apiKey, {
      content,
    });
    return result;
  } catch (err) {
    console.error('Moltbook comment error:', err.message);
    return { status: 500, error: err.message };
  }
}

module.exports = { verifyAgent, postToSubmolt, commentOnPost, moltbookRequest };
