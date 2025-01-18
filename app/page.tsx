"use client";

import { useState } from "react";
import { WalletManager } from "./components/WalletManager";
import { VerificationPanel } from "./components/VerificationPanel";

// For now, always use Anvil in development
const USE_ANVIL = process.env.NODE_ENV === "development";

export default function Home() {
  const [resetKey, setResetKey] = useState(0);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [isUpgradeConfirmed, setIsUpgradeConfirmed] = useState(false);

  const handleReset = () => {
    setWalletAddress(null);
    setTxHash(null);
    setIsUpgradeConfirmed(false);
    setResetKey((prev) => prev + 1);
  };

  const handleUpgradeComplete = async (
    address: `0x${string}`,
    hash: string
  ) => {
    setTxHash(hash);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setIsUpgradeConfirmed(true);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-8">EIP-7702 Wallet Demo</h1>

      <WalletManager
        useAnvil={USE_ANVIL}
        onWalletCreated={setWalletAddress}
        onUpgradeComplete={handleUpgradeComplete}
        resetKey={resetKey}
      />

      {walletAddress && (
        <div className="mt-4 text-center">
          <p className="mb-2">New Wallet Address:</p>
          <code className="bg-gray-900 text-green-400 p-2 rounded font-mono">
            {walletAddress}
          </code>
        </div>
      )}

      {txHash && (
        <div className="mt-4 text-center">
          <p className="mb-2">Transaction Hash:</p>
          <a
            href={`http://localhost:8545/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            <code className="bg-gray-900 text-green-400 p-2 rounded font-mono">
              {txHash}
            </code>
          </a>
        </div>
      )}

      {isUpgradeConfirmed && walletAddress && (
        <VerificationPanel
          smartWalletAddress={walletAddress as `0x${string}`}
          useAnvil={USE_ANVIL}
        />
      )}

      <div className="mt-8 mb-4 border-t border-gray-700 w-full max-w-2xl"></div>

      <button
        onClick={handleReset}
        className="mt-4 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
      >
        Reset Demo
      </button>
    </main>
  );
}
