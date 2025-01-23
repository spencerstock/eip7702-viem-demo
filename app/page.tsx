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
        <div className="mt-4">
          <div className="bg-gray-900 text-green-400 p-4 rounded font-mono text-left">
            <span className="text-gray-400 mr-2">New Wallet Address:</span>
            {walletAddress}
          </div>
        </div>
      )}

      {upgradeTxHash && (
        <div className="mt-4">
          <div className="bg-gray-900 text-green-400 p-4 rounded font-mono text-left">
            <span className="text-gray-400 mr-2">Upgrade Transaction:</span>
            <a
              href={`${odysseyTestnet.blockExplorers.default.url}/tx/${upgradeTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline"
            >
              {upgradeTxHash}
            </a>
          </div>
        </div>
      )}

      {initTxHash && (
        <div className="mt-4">
          <div className="bg-gray-900 text-green-400 p-4 rounded font-mono text-left">
            <span className="text-gray-400 mr-2">Initialize Transaction:</span>
            <a
              href={`${odysseyTestnet.blockExplorers.default.url}/tx/${initTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline"
            >
              {initTxHash}
            </a>
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
