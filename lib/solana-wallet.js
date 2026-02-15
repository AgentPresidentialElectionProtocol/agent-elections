/**
 * Solana Wallet Management for Agent Elections
 * Uses Solana Agent Kit for wallet operations and x402 payments
 */

const { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { getAssociatedTokenAddress, getAccount } = require('@solana/spl-token');
const bs58 = require('bs58').default;

// USDC SPL Token mint address on Solana mainnet
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDC_DECIMALS = 6; // USDC has 6 decimals

class SolanaWalletManager {
  constructor(config = {}) {
    this.rpcUrl = config.rpcUrl || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.network = config.network || process.env.SOLANA_NETWORK || 'mainnet-beta';
    this.connection = new Connection(this.rpcUrl, 'confirmed');
  }

  /**
   * Create a new Solana wallet for a candidate
   * @returns {Object} { publicKey, privateKey, address }
   */
  createWallet() {
    const keypair = Keypair.generate();

    return {
      publicKey: keypair.publicKey.toString(),
      privateKey: bs58.encode(keypair.secretKey),
      address: keypair.publicKey.toString(),
      network: 'solana'
    };
  }

  /**
   * Get USDC balance for a Solana wallet
   * @param {string} walletAddress - Solana wallet public key
   * @returns {Promise<number>} USDC balance in decimal format (e.g., 100.50)
   */
  async getUSDCBalance(walletAddress) {
    try {
      const walletPubkey = new PublicKey(walletAddress);

      // Get the associated token account for USDC
      const tokenAccount = await getAssociatedTokenAddress(
        USDC_MINT,
        walletPubkey
      );

      // Get account info
      const accountInfo = await getAccount(this.connection, tokenAccount);

      // Convert lamports to USDC (6 decimals)
      const balance = Number(accountInfo.amount) / Math.pow(10, USDC_DECIMALS);

      return balance;
    } catch (error) {
      // If account doesn't exist or has no USDC, return 0
      if (
        error.name === 'TokenAccountNotFoundError' ||
        error.message?.includes('could not find account') ||
        error.message?.includes('Invalid') ||
        error.message?.includes('not found')
      ) {
        return 0;
      }
      // For unexpected errors, log but still return 0
      console.error('Error getting USDC balance:', error.name, error.message);
      return 0;
    }
  }

  /**
   * Get SOL balance for a wallet (for gas fees)
   * @param {string} walletAddress - Solana wallet public key
   * @returns {Promise<number>} SOL balance
   */
  async getSOLBalance(walletAddress) {
    try {
      const walletPubkey = new PublicKey(walletAddress);
      const balance = await this.connection.getBalance(walletPubkey);
      return balance / LAMPORTS_PER_SOL;
    } catch (error) {
      console.error('Error getting SOL balance:', error);
      throw error;
    }
  }

  /**
   * Verify a transaction on Solana blockchain
   * @param {string} txHash - Transaction signature
   * @returns {Promise<Object>} Transaction details
   */
  async verifyTransaction(txHash) {
    try {
      const transaction = await this.connection.getTransaction(txHash, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      });

      if (!transaction) {
        return {
          verified: false,
          error: 'Transaction not found'
        };
      }

      return {
        verified: true,
        blockTime: transaction.blockTime,
        slot: transaction.slot,
        confirmations: await this.getConfirmations(transaction.slot),
        fee: transaction.meta?.fee / LAMPORTS_PER_SOL,
        success: transaction.meta?.err === null
      };
    } catch (error) {
      console.error('Error verifying transaction:', error);
      return {
        verified: false,
        error: error.message
      };
    }
  }

  /**
   * Get number of confirmations for a transaction
   * @param {number} slot - Transaction slot number
   * @returns {Promise<number>} Number of confirmations
   */
  async getConfirmations(slot) {
    try {
      const currentSlot = await this.connection.getSlot();
      return currentSlot - slot;
    } catch (error) {
      console.error('Error getting confirmations:', error);
      return 0;
    }
  }

  /**
   * Parse USDC transfer from transaction
   * @param {string} txHash - Transaction signature
   * @returns {Promise<Object>} Transfer details
   */
  async parseUSDCTransfer(txHash) {
    try {
      const transaction = await this.connection.getParsedTransaction(txHash, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      });

      if (!transaction || !transaction.meta) {
        return null;
      }

      // Look for SPL token transfer instructions
      const instructions = transaction.transaction.message.instructions;

      for (const instruction of instructions) {
        if (instruction.program === 'spl-token' && instruction.parsed?.type === 'transfer') {
          const info = instruction.parsed.info;

          // Check if it's a USDC transfer
          const tokenAddress = info.mint;
          if (tokenAddress === USDC_MINT.toString()) {
            return {
              from: info.source,
              to: info.destination,
              amount: Number(info.amount) / Math.pow(10, USDC_DECIMALS),
              mint: tokenAddress,
              authority: info.authority,
              blockTime: transaction.blockTime,
              slot: transaction.slot
            };
          }
        }
      }

      return null;
    } catch (error) {
      console.error('Error parsing USDC transfer:', error);
      return null;
    }
  }

  /**
   * Validate a Solana wallet address
   * @param {string} address - Wallet address to validate
   * @returns {boolean} True if valid
   */
  isValidAddress(address) {
    try {
      const pubkey = new PublicKey(address);
      return PublicKey.isOnCurve(pubkey.toBuffer());
    } catch {
      return false;
    }
  }

  /**
   * Get recent transactions for a wallet
   * @param {string} walletAddress - Solana wallet public key
   * @param {number} limit - Number of transactions to fetch
   * @returns {Promise<Array>} Array of transaction signatures
   */
  async getRecentTransactions(walletAddress, limit = 10) {
    try {
      const walletPubkey = new PublicKey(walletAddress);
      const signatures = await this.connection.getSignaturesForAddress(
        walletPubkey,
        { limit }
      );

      return signatures.map(sig => ({
        signature: sig.signature,
        blockTime: sig.blockTime,
        slot: sig.slot,
        err: sig.err,
        confirmationStatus: sig.confirmationStatus
      }));
    } catch (error) {
      console.error('Error getting recent transactions:', error);
      throw error;
    }
  }

  /**
   * Estimate transaction fee
   * @returns {Promise<number>} Estimated fee in SOL
   */
  async estimateFee() {
    try {
      // Typical Solana transaction fee is 5000 lamports
      const recentFees = await this.connection.getRecentPerformanceSamples(1);
      if (recentFees.length > 0) {
        return 5000 / LAMPORTS_PER_SOL; // ~0.000005 SOL
      }
      return 0.000005; // Default estimate
    } catch (error) {
      console.error('Error estimating fee:', error);
      return 0.000005;
    }
  }

  /**
   * Get wallet info (balances, recent activity)
   * @param {string} walletAddress - Solana wallet public key
   * @returns {Promise<Object>} Wallet information
   */
  async getWalletInfo(walletAddress) {
    try {
      const [usdcBalance, solBalance, recentTxs] = await Promise.all([
        this.getUSDCBalance(walletAddress),
        this.getSOLBalance(walletAddress),
        this.getRecentTransactions(walletAddress, 5)
      ]);

      return {
        address: walletAddress,
        network: 'solana',
        balances: {
          usdc: usdcBalance,
          sol: solBalance
        },
        recentTransactions: recentTxs,
        isValid: this.isValidAddress(walletAddress)
      };
    } catch (error) {
      console.error('Error getting wallet info:', error);
      throw error;
    }
  }
}

module.exports = SolanaWalletManager;
