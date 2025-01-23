import { useState, useCallback } from "react";
import { type Address, type Hash, createPublicClient, http } from "viem";
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

type VerificationStep = {
  status: string;
  isComplete: boolean;
  txHash?: Hash;
  userOpHash?: Hash;
  error?: string;
};

type Props = {
  smartWalletAddress: Address;
  passkey: P256Credential;
  useAnvil?: boolean;
};

const waitForTransaction = async (
  hash: Hash,
  chain: typeof odysseyTestnet | typeof localAnvil
) => {
  const publicClient = createPublicClient({
    chain,
    transport: http(),
  });
  await publicClient.waitForTransactionReceipt({ hash });
};

function TransactionLink({
  hash,
  useAnvil,
}: {
  hash: Hash;
  useAnvil: boolean;
}) {
  if (useAnvil) {
    return <code className="font-mono text-green-400">{hash}</code>;
  }
  return (
    <a
      href={`${odysseyTestnet.blockExplorers.default.url}/tx/${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-400 hover:text-blue-300 underline font-mono"
    >
      {hash}
    </a>
  );
}

function StepDisplay({
  step,
  useAnvil,
}: {
  step: VerificationStep;
  useAnvil: boolean;
}) {
  return (
    <div className="mb-4 p-4 bg-gray-800 rounded-lg w-full max-w-5xl mx-auto">
      <div className="flex items-center gap-2">
        {step.isComplete ? (
          <span className="text-green-500">✓</span>
        ) : (
          <div className="w-4 h-4 border-2 border-t-blue-500 border-r-blue-500 border-b-blue-500 border-l-transparent rounded-full animate-spin" />
        )}
        <span className={step.isComplete ? "text-green-500" : "text-blue-500"}>
          {step.status}
        </span>
      </div>
      {step.txHash && (
        <div className="mt-2 ml-6">
          <span className="text-gray-400 mr-2">Transaction:</span>
          <div className="break-all">
            <TransactionLink hash={step.txHash} useAnvil={useAnvil} />
          </div>
        </div>
      )}
      {step.userOpHash && (
        <div className="mt-2 ml-6">
          <span className="text-gray-400 mr-2">UserOperation:</span>
          <div className="break-all">
            <code className="font-mono text-green-400">{step.userOpHash}</code>
          </div>
        </div>
      )}
      {step.error && (
        <div className="mt-2 ml-6 text-red-400">
          <span>Error: {step.error}</span>
        </div>
      )}
    </div>
  );
}

const MIN_DEPOSIT = BigInt("100000000000000000"); // 0.1 ETH

export function PasskeyVerification({
  smartWalletAddress,
  passkey,
  useAnvil = false,
}: Props) {
  const [verifying, setVerifying] = useState(false);
  const [steps, setSteps] = useState<VerificationStep[]>([]);
  const [isVerified, setIsVerified] = useState(false);
  const chain = useAnvil ? localAnvil : odysseyTestnet;

  const updateStep = (index: number, updates: Partial<VerificationStep>) => {
    setSteps((current) =>
      current.map((step, i) => (i === index ? { ...step, ...updates } : step))
    );
  };

  const addStep = (step: VerificationStep) => {
    setSteps((current) => [...current, step]);
  };

  const handleVerify = useCallback(async () => {
    try {
      setVerifying(true);
      setSteps([]);

      // Step 1: Create WebAuthn account and prepare client
      console.log("Creating WebAuthn account from passkey...");
      const webAuthnAccount = toWebAuthnAccount({ credential: passkey });
      console.log("WebAuthn account public key:", webAuthnAccount.publicKey);

      const publicClient = createPublicClient({
        chain,
        transport: http(),
      });

      // Check current EntryPoint deposit
      console.log("Checking current EntryPoint deposit...");
      const currentDeposit = (await publicClient.readContract({
        address: EntryPointAddress,
        abi: EntryPointAbi,
        functionName: "balanceOf",
        args: [smartWalletAddress],
      })) as bigint;
      console.log("Current deposit:", currentDeposit.toString(), "wei");

      // Check smart account balance
      console.log("Checking smart account balance...");
      const accountBalance = await publicClient.getBalance({
        address: smartWalletAddress,
      });
      console.log("Smart account balance:", accountBalance.toString(), "wei");

      if (accountBalance === BigInt(0)) {
        console.log(
          "Smart account has no balance, sending 1 wei from relayer..."
        );
        const response = await fetch("/api/relay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "fund",
            targetAddress: smartWalletAddress,
            value: "1",
            useAnvil,
          }),
        });
        if (!response.ok) {
          throw new Error("Failed to fund smart account");
        }
        const { hash } = await response.json();
        console.log("Funding transaction hash:", hash);
        await waitForTransaction(hash as Hash, chain);
        console.log("Smart account funded with 1 wei");
      }

      // Step 2: Pre-fund deposit if needed
      if (currentDeposit < MIN_DEPOSIT) {
        console.log("Insufficient deposit, pre-funding required...");
        addStep({
          status: "Pre-funding smart account gas in EntryPoint...",
          isComplete: false,
        });

        const depositResponse = await fetch("/api/verify-passkey/deposit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ smartWalletAddress, useAnvil }),
        });

        if (!depositResponse.ok) {
          const error = await depositResponse.text();
          updateStep(0, { error, isComplete: true });
          return;
        }

        const { txHash: depositTxHash } = await depositResponse.json();
        console.log("Deposit transaction hash:", depositTxHash);
        updateStep(0, {
          status: "Waiting for gas pre-funding transaction...",
          isComplete: false,
          txHash: depositTxHash,
        });

        await waitForTransaction(depositTxHash, chain);
        const newDeposit = (await publicClient.readContract({
          address: EntryPointAddress,
          abi: EntryPointAbi,
          functionName: "balanceOf",
          args: [smartWalletAddress],
        })) as bigint;
        console.log("New deposit balance:", newDeposit.toString(), "wei");

        updateStep(0, {
          status: "Gas pre-funding complete",
          isComplete: true,
          txHash: depositTxHash,
        });
      } else {
        console.log("Sufficient deposit exists, skipping pre-funding");
      }

      // Step 3: Prepare and sign userOp
      console.log("Getting owner index...");
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

      const ourOwnerIndex = Number(nextOwnerIndex - BigInt(1));
      console.log("Using owner index:", ourOwnerIndex);

      console.log("Creating smart account client...");
      const smartAccount = await toCoinbaseSmartAccount({
        client: publicClient,
        owners: [webAuthnAccount],
        address: smartWalletAddress,
        ownerIndex: ourOwnerIndex,
      });

      addStep({
        status:
          "Creating and signing userOp to transfer 1 wei back to relayer...",
        isComplete: false,
      });

      // Create and sign userOp
      console.log("Encoding transfer call...");
      const callData = await smartAccount.encodeCalls([
        {
          to: process.env.NEXT_PUBLIC_RELAYER_ADDRESS as Address,
          value: BigInt(1),
          data: "0x" as const,
        },
      ]);

      console.log("Getting nonce...");
      const nonce = await smartAccount.getNonce();
      console.log("Current nonce:", nonce.toString());

      console.log("Preparing userOperation...");
      const unsignedUserOp = {
        sender: smartAccount.address,
        nonce,
        initCode: "0x" as const,
        callData,
        callGasLimit: BigInt(500000),
        verificationGasLimit: BigInt(500000),
        preVerificationGas: BigInt(100000),
        maxFeePerGas: BigInt(3000000000),
        maxPriorityFeePerGas: BigInt(2000000000),
        paymasterAndData: "0x" as const,
        signature: "0x" as const,
      } as const;

      console.log("Signing userOperation...");
      const signature = await smartAccount.signUserOperation(unsignedUserOp);
      console.log("Signature length:", (signature.length - 2) / 2, "bytes");

      const userOp = { ...unsignedUserOp, signature } as UserOperation;
      console.log("UserOperation prepared:", serializeBigInts(userOp));

      updateStep(1, {
        status: "UserOperation created and signed",
        isComplete: true,
      });

      // Step 4: Submit userOp
      addStep({
        status: "Submitting userOperation...",
        isComplete: false,
      });

      const submitResponse = await fetch("/api/verify-passkey/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userOp: serializeBigInts(userOp),
          useAnvil,
        }),
      });

      if (!submitResponse.ok) {
        const error = await submitResponse.text();
        updateStep(2, { error, isComplete: true });
        return;
      }

      const { txHash, userOpHash } = await submitResponse.json();
      updateStep(2, {
        status: "Waiting for userOperation transaction...",
        isComplete: false,
        txHash,
        userOpHash,
      });

      await waitForTransaction(txHash, chain);
      updateStep(2, {
        status: "UserOperation submitted successfully",
        isComplete: true,
        txHash,
        userOpHash,
      });

      // Step 5: Retrieve unused deposit
      addStep({
        status: "Retrieving unused deposit...",
        isComplete: false,
      });

      const retrieveResponse = await fetch("/api/verify-passkey/retrieve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          smartWalletAddress,
          useAnvil,
        }),
      });

      if (!retrieveResponse.ok) {
        const error = await retrieveResponse.text();
        updateStep(3, { error, isComplete: true });
        return;
      }

      const { txHash: retrieveTxHash } = await retrieveResponse.json();
      if (retrieveTxHash) {
        updateStep(3, {
          status: "Waiting for withdrawal transaction...",
          isComplete: false,
          txHash: retrieveTxHash,
        });

        await waitForTransaction(retrieveTxHash, chain);
        updateStep(3, {
          status: "Successfully retrieved unused deposit",
          isComplete: true,
          txHash: retrieveTxHash,
        });
      } else {
        updateStep(3, {
          status: "No unused deposit to retrieve",
          isComplete: true,
        });
      }
      setIsVerified(true);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      addStep({
        status: "Verification failed",
        isComplete: true,
        error: errorMessage,
      });
    } finally {
      setVerifying(false);
    }
  }, [smartWalletAddress, passkey, useAnvil, chain]);

  return (
    <div className="flex flex-col items-center w-full max-w-5xl mx-auto mt-8">
      {!isVerified && (
        <button
          onClick={handleVerify}
          disabled={verifying}
          className="px-6 py-3 text-lg font-semibold text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed mb-8 w-64"
        >
          {verifying ? "Verifying..." : "Verify with Passkey"}
        </button>
      )}

      <div className="w-full space-y-4">
        {steps.map((step, index) => (
          <StepDisplay key={index} step={step} useAnvil={useAnvil} />
        ))}
      </div>

      {isVerified && steps.every((step) => step.isComplete && !step.error) && (
        <div className="mt-8 text-center text-green-500 font-semibold text-lg">
          ✅ Successfully submitted a userOp with passkey owner!
        </div>
      )}
    </div>
  );
}
