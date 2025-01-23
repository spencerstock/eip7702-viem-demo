"use client";

import { useState } from "react";
import { WalletManager } from "./components/WalletManager";
import { PasskeyVerification } from "./components/PasskeyVerification";
import { type ExtendedAccount } from "./lib/wallet-utils";
import { odysseyTestnet } from "./lib/chains";
import { type P256Credential } from "viem/account-abstraction";

export default function Home() {
  const [resetKey, setResetKey] = useState(0);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [upgradeTxHash, setUpgradeTxHash] = useState<string | null>(null);
  const [initTxHash, setInitTxHash] = useState<string | null>(null);
  const [isUpgradeConfirmed, setIsUpgradeConfirmed] = useState(false);
  const [account, setAccount] = useState<ExtendedAccount | null>(null);
  const [passkey, setPasskey] = useState<P256Credential | null>(null);

  const handleReset = () => {
    setWalletAddress(null);
    setUpgradeTxHash(null);
    setInitTxHash(null);
    setIsUpgradeConfirmed(false);
    setAccount(null);
    setPasskey(null);
    setResetKey((prev) => prev + 1);
  };

  const handleUpgradeComplete = async (
    address: `0x${string}`,
    upgradeHash: string,
    initHash: string
  ) => {
    setUpgradeTxHash(upgradeHash);
    setInitTxHash(initHash);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setIsUpgradeConfirmed(true);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-8">EIP-7702 Wallet Demo</h1>

      <WalletManager
        useAnvil={false}
        onWalletCreated={setWalletAddress}
        onUpgradeComplete={handleUpgradeComplete}
        resetKey={resetKey}
        onAccountCreated={setAccount}
        onPasskeyStored={setPasskey}
      />

      {walletAddress && (
        <div className="mb-4 w-full">
          <div className="p-4 bg-gray-800 rounded-lg w-full max-w-5xl mx-auto">
            <div className="flex items-center gap-2">
              <span className="text-green-500">✓</span>
              <span className="text-gray-400">New Wallet Address:</span>
              <div className="break-all text-green-500 font-mono">
                {walletAddress}
              </div>
            </div>
          </div>
        </div>
      )}

      {upgradeTxHash && (
        <div className="mb-4 w-full">
          <div className="p-4 bg-gray-800 rounded-lg w-full max-w-5xl mx-auto">
            <div className="flex items-center gap-2">
              <span className="text-green-500">✓</span>
              <span className="text-gray-400">Upgrade Transaction:</span>
              <div className="break-all">
                <a
                  href={`${odysseyTestnet.blockExplorers.default.url}/tx/${upgradeTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 underline font-mono"
                >
                  {upgradeTxHash}
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {initTxHash && (
        <div className="mb-4 w-full">
          <div className="p-4 bg-gray-800 rounded-lg w-full max-w-5xl mx-auto">
            <div className="flex items-center gap-2">
              <span className="text-green-500">✓</span>
              <span className="text-gray-400">Initialize Transaction:</span>
              <div className="break-all">
                <a
                  href={`${odysseyTestnet.blockExplorers.default.url}/tx/${initTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 underline font-mono"
                >
                  {initTxHash}
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {isUpgradeConfirmed && walletAddress && passkey && (
        <PasskeyVerification
          smartWalletAddress={walletAddress as `0x${string}`}
          passkey={passkey}
          useAnvil={false}
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
