import { useState, useEffect, useCallback } from "react";
import {
  parseEther,
  createPublicClient,
  http,
  type Hex,
  createWalletClient,
} from "viem";
import {
  createEOAWallet,
  getRelayerWalletClient,
  createEOAClient,
  encodeInitializeArgs,
  createInitializeHash,
  signInitialization,
  type ExtendedAccount,
  localAnvil,
} from "../lib/wallet-utils";
import { EIP7702ProxyAddresses } from "../lib/abi/EIP7702Proxy";
import { odysseyTestnet } from "../lib/chains";
import { VerificationPanel } from "./VerificationPanel";
import { PasskeyRegistration } from "./PasskeyRegistration";
import type { P256Credential } from "viem/account-abstraction";
import { PasskeyVerification } from "./PasskeyVerification";
import { type Address } from "viem";

// Test values
const INITIAL_FUNDING = BigInt(1); // 1 wei

interface WalletManagerProps {
  useAnvil: boolean;
  onWalletCreated: (address: string) => void;
  onUpgradeComplete: (
    address: `0x${string}`,
    upgradeHash: string,
    initHash: string
  ) => void;
  resetKey: number;
  onAccountCreated: (account: ExtendedAccount | null) => void;
}

function formatError(error: any): string {
  let errorMessage = "Failed to upgrade wallet: ";

  if (error.shortMessage) {
    errorMessage += error.shortMessage;
  } else if (error.message) {
    errorMessage += error.message;
  }

  // Check for contract revert reasons
  if (error.data?.message) {
    errorMessage += `\nContract message: ${error.data.message}`;
  }

  return errorMessage;
}

function formatExplorerLink(hash: string, useAnvil: boolean): string | null {
  if (useAnvil) {
    return null;
  }
  return `${odysseyTestnet.blockExplorers.default.url}/tx/${hash}`;
}

function TransactionHash({
  hash,
  useAnvil,
}: {
  hash: string;
  useAnvil: boolean;
}) {
  const link = formatExplorerLink(hash, useAnvil);
  if (!link) {
    return <span className="font-mono">{hash}</span>;
  }
  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-400 hover:text-blue-300 underline font-mono"
    >
      {hash}
    </a>
  );
}

export function WalletManager({ useAnvil = false }: WalletManagerProps) {
  const [status, setStatus] = useState<string[]>([]);
  const [passkey, setPasskey] = useState<P256Credential | null>(null);
  const [smartWalletAddress] = useState<`0x${string}`>(
    "0xdDfA044880512F1D5859d8F9B0d08838480DA02A" as `0x${string}`
  );

  const addStatus = useCallback((newStatus: string) => {
    setStatus((prev) => [...prev, newStatus]);
  }, []);

  const handleCredentialCreated = useCallback(
    (credential: P256Credential) => {
      setPasskey(credential);
      addStatus("Passkey stored for future use");
    },
    [addStatus]
  );

  return (
    <div className="flex flex-col gap-8">
      {smartWalletAddress && (
        <>
          <VerificationPanel
            smartWalletAddress={smartWalletAddress}
            useAnvil={useAnvil}
            onStatus={addStatus}
          />
          <PasskeyRegistration
            smartWalletAddress={smartWalletAddress}
            useAnvil={useAnvil}
            onStatus={addStatus}
            onCredentialCreated={handleCredentialCreated}
          />
          {passkey && (
            <PasskeyVerification
              smartWalletAddress={smartWalletAddress}
              passkey={passkey}
              useAnvil={useAnvil}
              onStatus={addStatus}
            />
          )}
          <div className="bg-gray-900 p-4 rounded">
            <h2 className="text-green-400 font-bold mb-2">Status Updates</h2>
            <div className="flex flex-col gap-1">
              {status.map((msg, i) => {
                if (
                  msg.includes("Transaction submitted:") ||
                  msg.includes("Transaction hash:")
                ) {
                  const hash = msg.split(":")[1].trim();
                  return (
                    <div key={i} className="text-green-400 font-mono">
                      Transaction submitted:{" "}
                      <TransactionHash hash={hash} useAnvil={useAnvil} />
                    </div>
                  );
                }
                return (
                  <div key={i} className="text-green-400 font-mono">
                    {msg}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
