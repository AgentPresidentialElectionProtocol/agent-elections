/**
 * Unified Wallet Manager for Agent Elections
 * Routes wallet operations to Solana or Base based on network preference
 */

const SolanaWalletManager = require('./solana-wallet');
const BaseWalletManager = require('./base-wallet');
const db = require('./db');

class WalletManager {
  constructor() {
    this.solana = new SolanaWalletManager();
    this.base = new BaseWalletManager();
    this.defaultNetwork = process.env.DEFAULT_NETWORK || 'solana';
  }

  /**
   * Create a wallet on the specified network
   * @param {string} network - 'solana' or 'base'
   * @returns {Promise<Object>} Wallet details
   */
  async createWallet(network = this.defaultNetwork) {
    if (network === 'solana') {
      return this.solana.createWallet();
    } else if (network === 'base') {
      return await this.base.createWallet();
    } else {
      throw new Error(`Unsupported network: ${network}`);
    }
  }

  /**
   * Set up wallets for a candidate
   * @param {string} candidateId - Candidate UUID
   * @param {Object} options - { networks: ['solana', 'base'], preferredNetwork: 'solana' }
   * @returns {Promise<Object>} Created wallets
   */
  async setupCandidateWallets(candidateId, options = {}) {
    const networks = options.networks || [this.defaultNetwork];
    const preferredNetwork = options.preferredNetwork || this.defaultNetwork;

    const wallets = {};

    // Create wallets on requested networks
    for (const network of networks) {
      try {
        const wallet = await this.createWallet(network);
        wallets[network] = wallet;
      } catch (error) {
        console.error(`Error creating ${network} wallet:`, error);
        wallets[network] = { error: error.message };
      }
    }

    // Update candidate record in database
    const updateFields = {};

    if (wallets.solana && wallets.solana.address) {
      updateFields.wallet_address_solana = wallets.solana.address;
    }

    if (wallets.base && wallets.base.address) {
      updateFields.wallet_address_base = wallets.base.address;
    }

    updateFields.preferred_network = preferredNetwork;
    updateFields.fundraising_enabled = true;
    updateFields.wallet_created_at = new Date();
    updateFields.wallet_provider = networks.includes('solana') ? 'solana-agent-kit' : 'coinbase-sdk';

    // Build SQL update query
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updateFields)) {
      setClauses.push(`${key} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }

    values.push(candidateId);

    const query = `
      UPDATE candidates
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await db.query(query, values);

    return {
      candidate: result.rows[0],
      wallets,
      preferredNetwork
    };
  }

  /**
   * Get USDC balance for a wallet
   * @param {string} address - Wallet address
   * @param {string} network - 'solana' or 'base'
   * @returns {Promise<number>} USDC balance
   */
  async getUSDCBalance(address, network) {
    if (network === 'solana') {
      return await this.solana.getUSDCBalance(address);
    } else if (network === 'base') {
      return await this.base.getUSDCBalance(address);
    } else {
      throw new Error(`Unsupported network: ${network}`);
    }
  }

  /**
   * Get wallet balances for a candidate
   * @param {string} candidateId - Candidate UUID
   * @returns {Promise<Object>} Balances on all networks
   */
  async getCandidateBalances(candidateId) {
    const result = await db.query(
      `SELECT wallet_address_solana, wallet_address_base, preferred_network
       FROM candidates WHERE id = $1`,
      [candidateId]
    );

    if (result.rows.length === 0) {
      throw new Error('Candidate not found');
    }

    const candidate = result.rows[0];
    const balances = {};

    // Get Solana balance if wallet exists
    if (candidate.wallet_address_solana) {
      try {
        balances.solana = {
          usdc: await this.solana.getUSDCBalance(candidate.wallet_address_solana),
          sol: await this.solana.getSOLBalance(candidate.wallet_address_solana)
        };
      } catch (error) {
        console.error('Error getting Solana balance:', error);
        balances.solana = { error: error.message };
      }
    }

    // Get Base balance if wallet exists
    if (candidate.wallet_address_base) {
      try {
        balances.base = {
          usdc: await this.base.getUSDCBalance(candidate.wallet_address_base),
          eth: await this.base.getETHBalance(candidate.wallet_address_base)
        };
      } catch (error) {
        console.error('Error getting Base balance:', error);
        balances.base = { error: error.message };
      }
    }

    return {
      candidateId,
      preferredNetwork: candidate.preferred_network,
      balances
    };
  }

  /**
   * Verify a transaction on the specified network
   * @param {string} txHash - Transaction hash
   * @param {string} network - 'solana' or 'base'
   * @returns {Promise<Object>} Verification result
   */
  async verifyTransaction(txHash, network) {
    if (network === 'solana') {
      return await this.solana.verifyTransaction(txHash);
    } else if (network === 'base') {
      return await this.base.verifyTransaction(txHash);
    } else {
      throw new Error(`Unsupported network: ${network}`);
    }
  }

  /**
   * Parse a USDC transfer from a transaction
   * @param {string} txHash - Transaction hash
   * @param {string} network - 'solana' or 'base'
   * @returns {Promise<Object>} Transfer details
   */
  async parseUSDCTransfer(txHash, network) {
    if (network === 'solana') {
      return await this.solana.parseUSDCTransfer(txHash);
    } else if (network === 'base') {
      // Base parsing not implemented yet
      console.warn('Base USDC transfer parsing not implemented');
      return null;
    } else {
      throw new Error(`Unsupported network: ${network}`);
    }
  }

  /**
   * Validate a wallet address for the specified network
   * @param {string} address - Wallet address
   * @param {string} network - 'solana' or 'base'
   * @returns {boolean} True if valid
   */
  isValidAddress(address, network) {
    if (network === 'solana') {
      return this.solana.isValidAddress(address);
    } else if (network === 'base') {
      return this.base.isValidAddress(address);
    } else {
      return false;
    }
  }

  /**
   * Get full wallet info for a candidate
   * @param {string} candidateId - Candidate UUID
   * @returns {Promise<Object>} Complete wallet information
   */
  async getCandidateWalletInfo(candidateId) {
    const result = await db.query(
      `SELECT
        id,
        agent_id,
        agent_name,
        wallet_address_solana,
        wallet_address_base,
        preferred_network,
        fundraising_enabled,
        fundraising_goal_usdc,
        total_raised_usdc,
        total_raised_solana,
        total_raised_base,
        wallet_created_at
       FROM candidates WHERE id = $1`,
      [candidateId]
    );

    if (result.rows.length === 0) {
      throw new Error('Candidate not found');
    }

    const candidate = result.rows[0];
    const balances = await this.getCandidateBalances(candidateId);

    return {
      candidate: {
        id: candidate.id,
        agentId: candidate.agent_id,
        agentName: candidate.agent_name,
        fundraisingEnabled: candidate.fundraising_enabled,
        fundraisingGoal: candidate.fundraising_goal_usdc,
        totalRaised: candidate.total_raised_usdc,
        walletCreatedAt: candidate.wallet_created_at
      },
      wallets: {
        solana: candidate.wallet_address_solana,
        base: candidate.wallet_address_base,
        preferred: candidate.preferred_network
      },
      balances: balances.balances,
      totalRaised: {
        total: candidate.total_raised_usdc,
        solana: candidate.total_raised_solana,
        base: candidate.total_raised_base
      }
    };
  }
}

module.exports = WalletManager;
