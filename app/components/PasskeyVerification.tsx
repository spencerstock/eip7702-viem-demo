import { useState, useCallback } from "react";
import { type Address, type Hex, createPublicClient, http } from "viem";
import {
  type P256Credential,
  toWebAuthnAccount,
  toCoinbaseSmartAccount,
  type UserOperation,
} from "viem/account-abstraction";
import { odysseyTestnet } from "../lib/chains";
import { localAnvil } from "../lib/wallet-utils";
import { EntryPointAddress, EntryPointAbi } from "../lib/abi/EntryPoint";
import { serializeBigInts } from "../lib/smart-account";

type Props = {
  smartWalletAddress: Address;
  passkey: P256Credential;
  onStatus?: (status: string) => void;
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

export function PasskeyVerification({
  smartWalletAddress,
  passkey,
  onStatus,
  useAnvil = false,
}: Props) {
  const [verifying, setVerifying] = useState(false);
  const [isOwner, setIsOwner] = useState<boolean | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<string[]>([]);

  const handleVerify = useCallback(async () => {
    try {
      setVerifying(true);
      setVerificationStatus([]);
      onStatus?.("Creating WebAuthn account from passkey...");

      // Create WebAuthn account from the stored credential
      const webAuthnAccount = toWebAuthnAccount({
        credential: passkey,
      });
      // Create public client
      const publicClient = createPublicClient({
        chain: useAnvil ? localAnvil : odysseyTestnet,
        transport: http(),
      });

      // Get the owner index for this passkey
      onStatus?.("Getting owner index...");
      const nextOwnerIndex = await publicClient.readContract({
        address: smartWalletAddress,
        abi: [
          {
            type: "function",
            name: "nextOwnerIndex",
            inputs: [],
            outputs: [{ type: "uint256", name: "" }],
            stateMutability: "view",
          },
        ],
        functionName: "nextOwnerIndex",
      });

      // The owner index for our passkey should be nextOwnerIndex - 1
      // since we just added it in the registration step
      const ourOwnerIndex = Number(nextOwnerIndex - BigInt(1));
      onStatus?.(`Using owner index: ${ourOwnerIndex}`);

      // Create smart account client using the passkey's WebAuthn account
      onStatus?.("Creating smart account client...");
      const smartAccount = await toCoinbaseSmartAccount({
        client: publicClient,
        owners: [webAuthnAccount],
        address: smartWalletAddress,
        ownerIndex: ourOwnerIndex,
      });

      // Create user operation to send 1 wei back to relayer
      onStatus?.("Creating userOp to send 1 wei...");
      const callData = await smartAccount.encodeCalls([
        {
          to: process.env.NEXT_PUBLIC_RELAYER_ADDRESS as Address,
          value: BigInt(1),
          data: "0x",
        },
      ]);

      // Get the nonce
      const nonce = await smartAccount.getNonce();

      // Construct the userOp with reasonable gas values
      onStatus?.("Preparing userOperation...");
      const unsignedUserOp = {
        sender: smartAccount.address,
        nonce,
        initCode: "0x" as const,
        callData,
        callGasLimit: BigInt(500000),
        verificationGasLimit: BigInt(500000),
        preVerificationGas: BigInt(100000),
        maxFeePerGas: BigInt(3000000000), // 3 gwei
        maxPriorityFeePerGas: BigInt(2000000000), // 2 gwei
        paymasterAndData: "0x" as const,
        signature: "0x" as const,
      } as const;

      console.log("\n=== UserOp before signing ===");
      console.log(JSON.stringify(serializeBigInts(unsignedUserOp), null, 2));

      // Sign with WebAuthn account to get signature
      onStatus?.("Signing userOperation...");
      const signature = await smartAccount.signUserOperation(unsignedUserOp);

      console.log("\n=== Signature from signUserOperation ===");
      console.log("Raw signature:", signature);
      console.log("Signature length:", (signature.length - 2) / 2, "bytes");

      // Use the signature directly without any modifications
      const userOp = {
        ...unsignedUserOp,
        signature,
      } as UserOperation;

      onStatus?.("UserOperation prepared and signed");

      console.log("\n=== UserOp after signing (before serialization) ===");
      console.log(JSON.stringify(serializeBigInts(userOp), null, 2));

      // Serialize the userOp and log for debugging
      const serializedUserOp = serializeBigInts(userOp);
      console.log("\n=== UserOp after serialization ===");
      console.log(JSON.stringify(serializedUserOp, null, 2));

      onStatus?.("Calling verification API...");

      // Call backend to verify the passkey
      const response = await fetch("/api/verify-passkey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          smartWalletAddress,
          publicKey: webAuthnAccount.publicKey,
          userOp: serializedUserOp,
          useAnvil,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to verify passkey: ${errorText}`);
      }

      const { isOwner, status, error } = await response.json();
      setIsOwner(isOwner);
      if (status) {
        setVerificationStatus(status);
        status.forEach((msg: string) => onStatus?.(msg));
      }
      if (error) {
        onStatus?.(`Error: ${error}`);
      }
    } catch (error) {
      onStatus?.("Verification failed:");
      if (error instanceof Error) {
        try {
          // Try to parse the error message as JSON
          const errorText = error.message;
          if (errorText.includes("Failed to verify passkey: {")) {
            const jsonStr = errorText.split("Failed to verify passkey: ")[1];
            const errorData = JSON.parse(jsonStr);

            // Display a more structured error message
            onStatus?.("Error Details:");
            if (errorData.error) {
              const mainError = errorData.error.split("\n")[0]; // Get first line of error
              onStatus?.(`Main Error: ${mainError}`);

              // If it's a contract revert, show that separately
              if (errorData.error.includes("Contract Call:")) {
                const [_, contractError] =
                  errorData.error.split("Contract Call:");
                onStatus?.("Contract Call Details:");
                contractError.split("\n").forEach((line: string) => {
                  if (line.trim()) {
                    // Only show the first part of very long lines
                    const trimmedLine =
                      line.length > 100 ? line.slice(0, 100) + "..." : line;
                    onStatus?.(`  ${trimmedLine.trim()}`);
                  }
                });
              }
            }

            // Show status messages if any
            if (errorData.status && Array.isArray(errorData.status)) {
              onStatus?.("\nExecution Status:");
              errorData.status.forEach((msg: string) => {
                if (msg.includes("Error:")) {
                  // For error messages, only show the first line
                  const firstLine = msg.split("\n")[0];
                  onStatus?.(`  ${firstLine}`);
                } else {
                  onStatus?.(`  ${msg}`);
                }
              });
            }
          } else {
            // If not JSON, show the original error message
            onStatus?.(errorText);
          }
        } catch {
          // If JSON parsing fails, fall back to original error message
          onStatus?.(error.message);
        }
      } else {
        onStatus?.(String(error));
      }
    } finally {
      setVerifying(false);
    }
  }, [smartWalletAddress, passkey, useAnvil, onStatus]);

  return (
    <div className="flex flex-col gap-4 w-full">
      <button
        onClick={handleVerify}
        disabled={verifying}
        className="px-4 py-2 font-bold text-white bg-blue-500 rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {verifying ? "Verifying..." : "Verify with Passkey"}
      </button>
      {isOwner !== null && (
        <div
          className={`text-center font-bold ${
            isOwner ? "text-green-500" : "text-red-500"
          }`}
        >
          {isOwner
            ? "✅ Passkey is a valid owner!"
            : "❌ Passkey is not an owner."}
        </div>
      )}
      {verificationStatus.length > 0 && (
        <div
          className="mt-4 bg-gray-900 text-green-400 p-4 rounded font-mono text-sm"
          style={{ width: "100%", maxWidth: "600px" }}
        >
          <div style={{ overflowX: "scroll", width: "100%" }}>
            <div style={{ minWidth: "100%", whiteSpace: "pre" }}>
              {verificationStatus.map((status, index) => {
                // For transaction hashes
                if (
                  status.includes("Transaction hash:") ||
                  status.includes("UserOperation hash:")
                ) {
                  const [prefix, hash] = status.split(": ");
                  return (
                    <div key={index}>
                      {prefix}:{" "}
                      <TransactionHash hash={hash} useAnvil={useAnvil} />
                    </div>
                  );
                }

                // For error messages, truncate and add "Show More" button
                if (
                  status.length > 100 &&
                  (status.includes("Error:") ||
                    status.includes("Contract Call:"))
                ) {
                  return (
                    <details key={index} className="group cursor-pointer">
                      <summary className="list-none">
                        <span className="text-red-400">
                          {status.slice(0, 100)}...
                          <span className="text-blue-400 ml-2 group-open:hidden">
                            (Show More)
                          </span>
                        </span>
                      </summary>
                      <div
                        className="mt-2 pl-4 text-xs border-l-2 border-gray-700"
                        style={{ whiteSpace: "pre-wrap" }}
                      >
                        {status}
                      </div>
                    </details>
                  );
                }

                // For normal status messages
                return (
                  <div key={index} style={{ whiteSpace: "pre-wrap" }}>
                    {status}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
