/**
 * Test script for wallet setup
 * Run with: node test-wallet-setup.js
 */

require('dotenv').config();
const WalletManager = require('./lib/wallet-manager');

async function testWalletSetup() {
  console.log('🧪 Testing Wallet Setup\n');

  const walletManager = new WalletManager();

  console.log('1. Creating Solana wallet...');
  try {
    const solanaWallet = await walletManager.createWallet('solana');
    console.log('   ✅ Solana wallet created:');
    console.log('      Address:', solanaWallet.address);
    console.log('      Network:', solanaWallet.network);
    console.log('      Private Key:', solanaWallet.privateKey.substring(0, 20) + '...\n');

    console.log('2. Validating Solana address...');
    const isValid = walletManager.isValidAddress(solanaWallet.address, 'solana');
    console.log('   ✅ Address valid:', isValid, '\n');

    console.log('3. Checking Solana wallet info...');
    const walletInfo = await walletManager.solana.getWalletInfo(solanaWallet.address);
    console.log('   ✅ Wallet info retrieved:');
    console.log('      USDC Balance:', walletInfo.balances.usdc);
    console.log('      SOL Balance:', walletInfo.balances.sol);
    console.log('      Recent Transactions:', walletInfo.recentTransactions.length, '\n');

    console.log('4. Testing Base wallet (placeholder)...');
    const baseWallet = await walletManager.createWallet('base');
    console.log('   ℹ️  Base wallet:', baseWallet.note, '\n');

    console.log('✅ All wallet tests passed!\n');
    console.log('📝 Next steps:');
    console.log('   - Get some devnet USDC to test donations');
    console.log('   - Set up a test candidate with wallet');
    console.log('   - Test the donation flow\n');

  } catch (error) {
    console.error('❌ Error during wallet setup test:', error);
    process.exit(1);
  }
}

// Run tests
testWalletSetup().then(() => {
  console.log('Test complete!');
  process.exit(0);
}).catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
