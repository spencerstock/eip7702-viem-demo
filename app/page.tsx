"use client";

import { useState, useEffect } from "react";
import { WalletManager } from "./components/WalletManager";
import { PasskeyVerification } from "./components/PasskeyVerification";
import { type ExtendedAccount, createEOAClient } from "./lib/wallet-utils";
import { odysseyTestnet } from "./lib/chains";
import { type P256Credential } from "viem/account-abstraction";
import { AccountDisruption } from "./components/AccountDisruption";
import { AccountState } from "./components/AccountState";
import { PROXY_TEMPLATE_ADDRESSES, NEW_IMPLEMENTATION_ADDRESS } from "./lib/contracts";
import { privateKeyToAccount } from "viem/accounts";

export default function Home() {
  const [resetKey, setResetKey] = useState(0);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletExplorerLink, setWalletExplorerLink] = useState<string | null>(null);
  const [upgradeTxHash, setUpgradeTxHash] = useState<string | null>(null);
  const [bytecode, setBytecode] = useState<string | null>(null);
  const [isUpgradeConfirmed, setIsUpgradeConfirmed] = useState(false);
  const [account, setAccount] = useState<ExtendedAccount | null>(null);
  const [passkey, setPasskey] = useState<P256Credential | null>(null);
  const [isDelegateDisrupted, setIsDelegateDisrupted] = useState(false);
  const [isImplementationDisrupted, setIsImplementationDisrupted] = useState(false);
  const [currentBytecode, setCurrentBytecode] = useState<string | null>(null);
  const [currentSlotValue, setCurrentSlotValue] = useState<string | null>(null);

  const handleReset = () => {
    setWalletAddress(null);
    setWalletExplorerLink(null);
    setUpgradeTxHash(null);
    setBytecode(null);
    setIsUpgradeConfirmed(false);
    setAccount(null);
    setPasskey(null);
    setIsDelegateDisrupted(false);
    setIsImplementationDisrupted(false);
    setCurrentBytecode(null);
    setCurrentSlotValue(null);
    setResetKey((prev) => prev + 1);
  };

  const handleDisruptionComplete = (type: 'delegate' | 'implementation') => {
    if (type === 'delegate') {
      setIsDelegateDisrupted(true);
    } else {
      setIsImplementationDisrupted(true);
    }
  };

  const handleRecoveryComplete = () => {
    setIsDelegateDisrupted(false);
    setIsImplementationDisrupted(false);
  };

  const handleStateChange = (bytecode: string | null, slotValue: string | null) => {
    // Update current values if they're provided
    if (bytecode !== null) {
      setCurrentBytecode(bytecode);
      
      // Check if delegate is disrupted by comparing bytecode with expected format
      const expectedBytecode = `0xef0100${PROXY_TEMPLATE_ADDRESSES.odyssey.slice(2).toLowerCase()}`.toLowerCase();
      const currentBytecode = bytecode.toLowerCase();

      console.log("\n=== Delegate State Change ===");
      console.log("Expected bytecode:", expectedBytecode);
      console.log("Current bytecode:", currentBytecode);
      console.log("Previous delegate state:", isDelegateDisrupted);

      const newDelegateDisrupted = currentBytecode !== "0x" && currentBytecode !== expectedBytecode;
      console.log("Setting delegate disrupted to:", newDelegateDisrupted);
      setIsDelegateDisrupted(newDelegateDisrupted);
    }

    if (slotValue !== null) {
      setCurrentSlotValue(slotValue);

      console.log("\n=== Implementation State Change ===");
      console.log("Expected implementation:", NEW_IMPLEMENTATION_ADDRESS.toLowerCase());
      console.log("Current implementation:", slotValue.toLowerCase());
      console.log("Previous implementation state:", isImplementationDisrupted);

      const newImplementationDisrupted = slotValue.toLowerCase() !== NEW_IMPLEMENTATION_ADDRESS.toLowerCase();
      console.log("Setting implementation disrupted to:", newImplementationDisrupted);
      setIsImplementationDisrupted(newImplementationDisrupted);
    }
  };

  const handleUpgradeComplete = async (
    address: `0x${string}`,
    upgradeHash: string,
    code: string
  ) => {
    setUpgradeTxHash(upgradeHash);
    setBytecode(code);
    setIsUpgradeConfirmed(true);
    setCurrentBytecode(code);
  };

  useEffect(() => {
    const initAccount = async () => {
      // Initialize with a new random private key for testing
      const privateKey = "0x1234567890123456789012345678901234567890123456789012345678901234";
      const viemAccount = privateKeyToAccount(privateKey as `0x${string}`);
      setAccount(viemAccount as unknown as ExtendedAccount);
    };

    initAccount();
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-4">
          <a
            href="https://github.com/ethereum/EIPs/blob/master/EIPS/eip-7702.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 underline"
          >
            EIP-7702
          </a>{" "}
          Demo
        </h1>
        <p className="text-xl text-gray-400">
          Upgrade an EOA to a CoinbaseSmartWallet
        </p>
      </div>

      <div className="mb-8">
        <WalletManager
          useAnvil={false}
          onWalletCreated={(address, explorerLink) => {
            setWalletAddress(address);
            setWalletExplorerLink(explorerLink);
          }}
          onUpgradeComplete={handleUpgradeComplete}
          resetKey={resetKey}
          onAccountCreated={setAccount}
          onPasskeyStored={setPasskey}
        />
      </div>

      {walletAddress && (
        <div className="mb-4 w-full">
          <div className="p-4 bg-gray-800 rounded-lg w-full max-w-5xl mx-auto">
            <div className="flex items-center gap-2">
              <span className="text-green-500">✓</span>
              <span className="text-gray-400">New EOA Address:</span>
              <div className="break-all">
                {walletExplorerLink ? (
                  <a
                    href={walletExplorerLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 underline font-mono"
                  >
                    {walletAddress}
                  </a>
                ) : (
                  <span className="text-green-500 font-mono">{walletAddress}</span>
                )}
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

      {bytecode && (
        <div className="mb-4 w-full">
          <div className="p-4 bg-gray-800 rounded-lg w-full max-w-5xl mx-auto">
            <div className="flex items-center gap-2">
              <span className="text-green-500">✓</span>
              <span className="text-gray-400">EOA Bytecode:</span>
              <div className="break-all text-green-500 font-mono">
                {bytecode}
              </div>
            </div>
          </div>
        </div>
      )}

      {isUpgradeConfirmed && passkey && (
        <div className="mb-4 w-full">
          <div className="p-4 bg-gray-800 rounded-lg w-full max-w-5xl mx-auto">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-green-500">✓</span>
              <span className="text-gray-400">Passkey Verification:</span>
              <div className="text-green-500">
                Successfully verified passkey as wallet owner
              </div>
            </div>
            <div className="ml-6 mt-2">
              <div className="text-gray-400 mb-1">Passkey Public Key:</div>
              <div className="break-all font-mono text-sm text-blue-400">
                {passkey.publicKey}
              </div>
            </div>
          </div>
        </div>
      )}

      {isUpgradeConfirmed && account && walletAddress && (
        <AccountDisruption
          account={account}
          smartWalletAddress={walletAddress as `0x${string}`}
          useAnvil={false}
          onDisruptionComplete={handleDisruptionComplete}
          isDelegateDisrupted={isDelegateDisrupted}
          isImplementationDisrupted={isImplementationDisrupted}
          currentBytecode={currentBytecode}
          currentSlotValue={currentSlotValue}
          onStateChange={handleStateChange}
        />
      )}

      {isUpgradeConfirmed && walletAddress && passkey && (
        <PasskeyVerification
          smartWalletAddress={walletAddress as `0x${string}`}
          passkey={passkey}
          account={account!}
          useAnvil={false}
          isDelegateDisrupted={isDelegateDisrupted}
          isImplementationDisrupted={isImplementationDisrupted}
          onRecoveryComplete={handleRecoveryComplete}
          onStateChange={handleStateChange}
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
