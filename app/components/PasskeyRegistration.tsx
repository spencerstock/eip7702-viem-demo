import { useState, useCallback } from "react";
import { type Address, type Hex } from "viem";
import {
  createWebAuthnCredential,
  toWebAuthnAccount,
  type P256Credential,
} from "viem/account-abstraction";
import { odysseyTestnet } from "../lib/chains";

type Props = {
  smartWalletAddress: Address;
  onStatus?: (status: string) => void;
  onCredentialCreated?: (credential: P256Credential) => void;
  useAnvil?: boolean;
};

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

export function PasskeyRegistration({
  smartWalletAddress,
  onStatus,
  onCredentialCreated,
  useAnvil = false,
}: Props) {
  const [registering, setRegistering] = useState(false);

  const handleRegisterPasskey = useCallback(async () => {
    try {
      setRegistering(true);
      onStatus?.("Creating passkey...");

      // Create the passkey using viem's helper
      const credential = await createWebAuthnCredential({
        name: "EIP-7702 Demo Passkey",
      });

      if (!credential) {
        throw new Error("Failed to create passkey");
      }

      onStatus?.("Passkey created successfully");
      onStatus?.("Creating WebAuthn account...");

      // Create a WebAuthn account from the credential
      const account = toWebAuthnAccount({
        credential,
      });

      onStatus?.("WebAuthn account created");
      onStatus?.("Debug: Account details:");
      onStatus?.(`Account: ${JSON.stringify(account, null, 2)}`);
      onStatus?.("Registering passkey as owner...");

      // Split the concatenated public key into x and y coordinates (32 bytes each)
      const publicKeyHex = account.publicKey as Hex;
      const x = `0x${publicKeyHex.slice(2, 66)}` as Hex; // First 32 bytes
      const y = `0x${publicKeyHex.slice(66)}` as Hex; // Last 32 bytes

      onStatus?.("Debug: Public Key Details:");
      onStatus?.(`x: ${x}`);
      onStatus?.(`y: ${y}`);

      // Call backend to register the passkey as an owner
      const response = await fetch("/api/register-passkey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          smartWalletAddress,
          x,
          y,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to register passkey as owner: ${errorText}`);
      }

      const { hash } = await response.json();
      onStatus?.(`Transaction submitted: ${hash}`);

      // Store the credential for later use
      onCredentialCreated?.(credential);
      onStatus?.("Passkey successfully registered as owner!");
    } catch (error) {
      onStatus?.("Failed to register passkey:");
      onStatus?.(`${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && error.cause) {
        onStatus?.(`Error cause: ${JSON.stringify(error.cause, null, 2)}`);
      }
    } finally {
      setRegistering(false);
    }
  }, [smartWalletAddress, onStatus, onCredentialCreated]);

  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={handleRegisterPasskey}
        disabled={registering}
        className="px-4 py-2 font-bold text-white bg-blue-500 rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {registering ? "Registering..." : "Register Passkey as Owner"}
      </button>
    </div>
  );
}
