import { useState, useEffect } from "react";
import { parseEther, createPublicClient, http } from "viem";
import {
  createEOAWallet,
  getRelayerWalletClient,
  createEOAClient,
  encodeInitializeArgs,
  createInitializeHash,
  localAnvil,
  signInitialization,
} from "../lib/wallet-utils";
import {
  EIP7702ProxyAbi,
  EIP7702ProxyAddresses,
} from "../lib/abi/EIP7702Proxy";

// Test values
const INITIAL_FUNDING = parseEther("0.001");

interface WalletManagerProps {
  useAnvil: boolean;
  onWalletCreated: (address: string) => void;
  onUpgradeComplete: (address: `0x${string}`, txHash: string) => void;
  resetKey: number;
}

export function WalletManager({
  useAnvil,
  onWalletCreated,
  onUpgradeComplete,
  resetKey,
}: WalletManagerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<ReturnType<
    typeof createEOAWallet
  > | null>(null);

  // Reset internal state when resetKey changes
  useEffect(() => {
    setLoading(false);
    setError(null);
    setAccount(null);
  }, [resetKey]);

  const handleCreateEOA = async () => {
    try {
      setLoading(true);
      setError(null);
      const newAccount = createEOAWallet();
      setAccount(newAccount);
      onWalletCreated(newAccount.address);
    } catch (error) {
      console.error("Error creating EOA:", error);
      setError("Failed to create EOA wallet");
    } finally {
      setLoading(false);
    }
  };

  const handleUpgradeWallet = async () => {
    if (!account) return;

    try {
      setLoading(true);
      setError(null);

      // Create user's wallet client for signing
      const userWallet = createEOAClient(account, useAnvil);

      // Get the relayer wallet for submitting the transaction
      const relayerWallet = await getRelayerWalletClient(useAnvil);

      // Create public client for reading state
      const publicClient = createPublicClient({
        chain: localAnvil,
        transport: http(),
      });

      // Get the proxy address based on network
      //   const proxyAddress = useAnvil ?
      //     EIP7702ProxyAddresses.anvil :
      //     EIP7702ProxyAddresses.baseSepolia;
      const proxyAddress = EIP7702ProxyAddresses.anvil;
      console.log("Debug - Using proxy address:", proxyAddress);
      console.log("Debug - Relayer address:", relayerWallet.account.address);

      // Create the authorization signature
      const authorization = await userWallet.signAuthorization({
        contractAddress: proxyAddress,
        sponsor: relayerWallet.account.address,
      });
      console.log("Debug - Authorization:", authorization);

      // const hash = await relayerWallet.writeContract({
      //     address: account.address as `0x${string}`, // Target the EOA instead of the proxy
      //     abi: [
      //       {
      //         type: "function",
      //         name: "initialize",
      //         inputs: [
      //           { name: "args", type: "bytes" },
      //           { name: "signature", type: "bytes" },
      //         ],
      //         outputs: [],
      //         stateMutability: "payable",
      //       },
      //     ],
      //     functionName: "initialize",
      //     args: [initArgs, signature],
      //     value: INITIAL_FUNDING,
      //     authorizationList: [authorization],
      //   });
      const hash = await relayerWallet.sendTransaction({
        to: account.address as `0x${string}`,
        value: INITIAL_FUNDING,
        authorizationList: [authorization],
      });

      console.log("Debug - Transaction hash:", hash);

      // Wait longer to ensure the transaction is processed
      //   console.log("Debug - Waiting for transaction to be mined...");
      //   await new Promise((resolve) => setTimeout(resolve, 3000));

      // Check the transaction receipt
      const receipt = await publicClient.getTransactionReceipt({
        hash: hash,
      });
      console.log("Debug - Transaction receipt:", receipt);
      console.log("Debug - Transaction status:", receipt.status);

      // Wait for next block to ensure code deployment
      //   console.log("Debug - Waiting for next block...");
      //   await publicClient.watchBlockNumber({
      //     onBlockNumber: () => {
      //       console.log("New block mined");
      //       return false; // Stop watching
      //     },
      //   });

      // Check if the code was deployed with retries
      console.log("Debug - Checking for code deployment...");
      let code;
      code = await publicClient.getCode({ address: account.address });

      if (code && code !== "0x") {
        console.log("Debug - Code deployed successfully!");
      } else {
        console.log("Debug - Code deployment failed");
      }

      if (!code || code === "0x") {
        // Also check the proxy template to make sure it has code
        const proxyCode = await publicClient.getCode({ address: proxyAddress });
        console.log("Debug - Proxy template code:", proxyCode);

        throw new Error(
          `Code deployment failed after 5 attempts. Transaction status: ${
            receipt.status
          }. Proxy template has code: ${!!proxyCode && proxyCode !== "0x"}`
        );
      }

      // Create initialization args with relayer as the owner
      const initArgs = encodeInitializeArgs(relayerWallet.account.address);
      console.log("Debug - Init args:", initArgs);

      console.log("Debug: proxyAddress", proxyAddress);
      // Create and sign the initialization hash
      const initHash = createInitializeHash(proxyAddress, initArgs);
      console.log("Debug - Init hash:", initHash);

      // Sign the hash with the EOA account (raw signature without Ethereum prefix)
      const signature = await signInitialization(userWallet, initHash);
      console.log("Debug - Raw signature:", signature);

      // attempting to call initialize on the EOA
      console.log("Debug - Calling initialize on the EOA");
      const initTxnHash = await relayerWallet.writeContract({
        address: account.address as `0x${string}`, // Target the EOA where code is now deployed
        abi: [
          {
            type: "function",
            name: "initialize",
            inputs: [
              { name: "args", type: "bytes" },
              { name: "signature", type: "bytes" },
            ],
            outputs: [],
            stateMutability: "payable",
          },
        ],
        functionName: "initialize",
        args: [initArgs, signature],
      });
      // Check the init transaction receipt
      const initReceipt = await publicClient.getTransactionReceipt({
        hash: initTxnHash,
      });
      console.log("Debug - INIT Transaction receipt:", initReceipt);
      console.log("Debug - INIT Transaction status:", initReceipt.status);

      onUpgradeComplete(account.address as `0x${string}`, hash);
    } catch (error: any) {
      console.error("Detailed upgrade error:", error);

      // Extract the most useful error information
      let errorMessage = "Failed to upgrade wallet: ";

      if (error.shortMessage) {
        errorMessage += error.shortMessage;
      } else if (error.message) {
        errorMessage += error.message;
      }

      // Check for nested error details
      if (error.cause) {
        errorMessage += `\nCause: ${error.cause.message || error.cause}`;
      }

      // Check for specific viem error details
      if (error.details) {
        errorMessage += `\nDetails: ${error.details}`;
      }

      // Check for contract revert reasons
      if (error.data?.message) {
        errorMessage += `\nContract message: ${error.data.message}`;
      }

      if (error.name === "ECDSAInvalidSignature") {
        errorMessage = "Invalid signature format: " + errorMessage;
      } else if (error.name === "ECDSAInvalidSignatureLength") {
        errorMessage = "Invalid signature length: " + errorMessage;
      } else if (error.name === "InvalidSignature") {
        errorMessage = "Signature verification failed: " + errorMessage;
      } else if (error.name === "FailedCall") {
        errorMessage = "Contract call failed: " + errorMessage;
      }

      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {!account && (
        <button
          onClick={handleCreateEOA}
          disabled={loading}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? "Creating..." : "Create new EOA Wallet"}
        </button>
      )}

      {account && (
        <button
          onClick={handleUpgradeWallet}
          disabled={loading}
          className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50"
        >
          {loading ? "Upgrading..." : "Upgrade EOA to Smart Wallet"}
        </button>
      )}

      {error && (
        <div className="mt-4 text-center text-red-500">
          <pre className="whitespace-pre-wrap text-left text-sm">{error}</pre>
        </div>
      )}
    </div>
  );
}
