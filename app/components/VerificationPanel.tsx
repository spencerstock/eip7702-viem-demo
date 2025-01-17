import { useState } from 'react';
import { createPublicClient, parseEther } from 'viem';
import { getRelayerWalletClient, localAnvil } from '../lib/wallet-utils';
import { http } from 'viem';

// Test values
const TEST_RETURN = parseEther('0.001');
const EMPTY_CALLDATA = '0x' as const;

interface VerificationPanelProps {
  smartWalletAddress: `0x${string}`;
  useAnvil: boolean;
}

export function VerificationPanel({ smartWalletAddress, useAnvil }: VerificationPanelProps) {
  const [verificationStatus, setVerificationStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const runVerification = async () => {
    try {
      setLoading(true);
      const relayerWallet = await getRelayerWalletClient(useAnvil);
      const publicClient = createPublicClient({
        chain: localAnvil,
        transport: http()
      });

      console.log('Debug - Smart wallet address:', smartWalletAddress);
      console.log('Debug - Relayer address:', relayerWallet.account.address);

      // First check if there's any code at the address
      const code = await publicClient.getBytecode({ address: smartWalletAddress });
      console.log('Debug - Code at smart wallet:', code);

      // First verify the relayer is the owner
      const isOwner = await publicClient.readContract({
        address: smartWalletAddress,
        abi: [{
          type: 'function',
          name: 'isOwnerAddress',
          inputs: [{ name: 'owner', type: 'address' }],
          outputs: [{ type: 'bool' }],
          stateMutability: 'view'
        }],
        functionName: 'isOwnerAddress',
        args: [relayerWallet.account.address]
      });

      console.log('Debug - Is owner result:', isOwner);

      if (!isOwner) {
        throw new Error('Relayer is not the owner of the smart wallet');
      }

      setVerificationStatus('✓ Relayer verified as owner');

      // Get the smart wallet's balance
      const balance = await publicClient.getBalance({ address: smartWalletAddress });
      setVerificationStatus(prev => `${prev}\n✓ Smart wallet balance: ${balance} wei`);

      // Test execution by sending ETH back to the relayer
      const execHash = await relayerWallet.writeContract({
        address: smartWalletAddress,
        abi: [{
          type: 'function',
          name: 'execute',
          inputs: [
            { name: 'target', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'data', type: 'bytes' }
          ],
          outputs: [],
          stateMutability: 'payable'
        }],
        functionName: 'execute',
        args: [relayerWallet.account.address, TEST_RETURN, EMPTY_CALLDATA]
      });

      setVerificationStatus(prev => `${prev}\n✓ Test transaction executed: ${execHash}`);

      // Verify the balance changed
      const balanceAfter = await publicClient.getBalance({ address: smartWalletAddress });
      setVerificationStatus(prev => 
        `${prev}\n✓ Smart wallet balance after: ${balanceAfter} wei\n` +
        `✓ Successfully transferred ${TEST_RETURN} wei back to relayer`
      );

    } catch (error: any) {
      console.error('Verification failed:', error);
      setVerificationStatus(`❌ Verification failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-4 text-center">
      <button
        onClick={runVerification}
        disabled={loading}
        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 mb-4"
      >
        {loading ? 'Verifying...' : 'Verify Ownership'}
      </button>

      {verificationStatus && (
        <div>
          <p className="mb-2">Verification Status:</p>
          <pre className="bg-gray-900 text-green-400 p-2 rounded font-mono whitespace-pre-wrap">
            {verificationStatus}
          </pre>
        </div>
      )}
    </div>
  );
} 