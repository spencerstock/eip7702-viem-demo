'use client';

import { useState } from 'react';
import { createWalletClient, http, parseEther, createPublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';

// TODO: Replace with actual contract ABI and address
const EIP7702_PROXY_ADDRESS = '0x0000000000000000000000000000000000000000';

export default function Home() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCreateAndUpgradeWallet = async () => {
    try {
      setLoading(true);

      // 1. Create new EOA wallet
      const randomBytes = crypto.getRandomValues(new Uint8Array(32));
      const privateKey = `0x${Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('')}` as const;
      const account = privateKeyToAccount(privateKey);
      setWalletAddress(account.address);

      // 2. Create wallet client
      const client = createWalletClient({
        account,
        chain: mainnet,
        transport: http()
      });

      // TODO: Replace with actual authorization object creation
      const authorizationObject = {
        owner: account.address,
        validUntil: BigInt(Math.floor(Date.now() / 1000) + 3600), // 1 hour from now
        validAfter: BigInt(Math.floor(Date.now() / 1000)),
      };

      // 3. Sign the authorization object
      const signature = await client.signMessage({
        message: JSON.stringify(authorizationObject)
      });

      // 4. Submit transaction to initialize the proxy
      const hash = await client.writeContract({
        address: EIP7702_PROXY_ADDRESS,
        abi: [], // TODO: Add actual ABI
        functionName: 'initialize',
        args: [authorizationObject, signature],
      });

      setTxHash(hash);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setWalletAddress(null);
    setTxHash(null);
    setLoading(false);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-8">EIP-7702 Wallet Demo</h1>
      
      {!walletAddress ? (
        <button
          onClick={handleCreateAndUpgradeWallet}
          disabled={loading}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? 'Processing...' : 'Create & Upgrade Wallet'}
        </button>
      ) : (
        <button
          onClick={handleReset}
          className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 mt-4"
        >
          Reset Demo
        </button>
      )}

      {walletAddress && (
        <div className="mt-4 text-center">
          <p className="mb-2">New Wallet Address:</p>
          <code className="bg-gray-900 text-green-400 p-2 rounded font-mono">{walletAddress}</code>
        </div>
      )}

      {txHash && (
        <div className="mt-4 text-center">
          <p className="mb-2">Transaction Hash:</p>
          <a 
            href={`https://etherscan.io/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            <code className="bg-gray-900 text-green-400 p-2 rounded font-mono">{txHash}</code>
          </a>
        </div>
      )}
    </main>
  );
}
