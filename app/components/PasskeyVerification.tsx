import { useState, useCallback } from "react";
import { type Address, type Hash, createPublicClient, http } from "viem";
import {
  type P256Credential,
  toWebAuthnAccount,
  toCoinbaseSmartAccount,
  type UserOperation,
} from "viem/account-abstraction";
import { odysseyTestnet } from "../lib/chains";
import { localAnvil, createSetImplementationHash, type ExtendedAccount, createEOAClient, signSetImplementation } from "../lib/wallet-utils";
import { EntryPointAddress, EntryPointAbi } from "../lib/abi/EntryPoint";
import { serializeBigInts } from "../lib/smart-account";
import { RecoveryModal } from "./RecoveryModal";
import { PROXY_TEMPLATE_ADDRESSES, NEW_IMPLEMENTATION_ADDRESS, ERC1967_IMPLEMENTATION_SLOT } from "../lib/contracts";
import { getNonceFromTracker } from "../lib/contract-utils";

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
  account: ExtendedAccount;
  useAnvil?: boolean;
  isDelegateDisrupted: boolean;
  isImplementationDisrupted: boolean;
  onRecoveryComplete: () => void;
  onStateChange: (bytecode: string | null, slotValue: string | null) => void;
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
          <span className="text-gray-400 mr-2">UserOperation hash:</span>
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
  account,
  useAnvil = false,
  isDelegateDisrupted,
  isImplementationDisrupted,
  onRecoveryComplete,
  onStateChange,
}: Props) {
  const [verifying, setVerifying] = useState(false);
  const [steps, setSteps] = useState<VerificationStep[]>([]);
  const [isVerified, setIsVerified] = useState(false);
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);
  const chain = useAnvil ? localAnvil : odysseyTestnet;

  const updateStep = (index: number, updates: Partial<VerificationStep>) => {
    setSteps((current) =>
      current.map((step, i) => (i === index ? { ...step, ...updates } : step))
    );
  };

  const addStep = (step: VerificationStep) => {
    setSteps((current) => [...current, step]);
  };

  // Add a function to check state
  const checkState = async () => {
    const publicClient = createPublicClient({
      chain: useAnvil ? localAnvil : odysseyTestnet,
      transport: http(),
    });

    const [code, slotValue] = await Promise.all([
      publicClient.getCode({ address: smartWalletAddress }),
      publicClient.getStorageAt({ 
        address: smartWalletAddress,
        slot: ERC1967_IMPLEMENTATION_SLOT
      })
    ]);

    // Format the slot value as an address (take last 20 bytes)
    const implementationAddress = slotValue 
      ? `0x${(slotValue as string).slice(-40)}` 
      : "0x";

    onStateChange(code || "0x", implementationAddress);
  };

  const handleVerify = useCallback(async () => {
    // If account is disrupted, show recovery modal instead of proceeding
    if (isDelegateDisrupted || isImplementationDisrupted) {
      setShowRecoveryModal(true);
      return;
    }

    try {
      // Reset states for new transaction
      setVerifying(true);
      setSteps([]);
      setIsVerified(false);

      // Create WebAuthn account
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

      // Step 1: Check and fund smart account if needed
      addStep({
        status: "Checking smart account balance...",
        isComplete: false,
      });

      // Check smart account balance
      console.log("Checking smart account balance...");
      const accountBalance = await publicClient.getBalance({
        address: smartWalletAddress,
      });
      console.log("Smart account balance:", accountBalance.toString(), "wei");

      if (accountBalance === BigInt(0)) {
        updateStep(0, {
          status: "Funding smart account with 1 wei...",
          isComplete: false,
        });

        console.log("Smart account has no balance, sending 1 wei from relayer...");
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

      updateStep(0, {
        status: "Smart account balance verified",
        isComplete: true,
      });

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
          updateStep(1, { error, isComplete: true });
          return;
        }

        const { txHash: depositTxHash } = await depositResponse.json();
        console.log("Deposit transaction hash:", depositTxHash);
        updateStep(1, {
          status: "Waiting for EntryPoint pre-funding transaction...",
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

        updateStep(1, {
          status: "EntryPoint pre-funding complete",
          isComplete: true,
          txHash: depositTxHash,
        });
      }

      // Step 3: Create and sign userOp
      addStep({
        status: "Creating and signing userOp to transfer 1 wei to relayer...",
        isComplete: false,
      });

      // Create and sign userOp
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

      updateStep(2, {
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
        updateStep(3, { error, isComplete: true });
        return;
      }

      const { txHash, userOpHash } = await submitResponse.json();
      updateStep(3, {
        status: "Waiting for userOperation transaction...",
        isComplete: false,
        txHash,
        userOpHash,
      });

      await waitForTransaction(txHash, chain);
      updateStep(3, {
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
        updateStep(4, { error, isComplete: true });
        return;
      }

      const { txHash: retrieveTxHash } = await retrieveResponse.json();
      if (retrieveTxHash) {
        updateStep(4, {
          status: "Waiting for withdrawal transaction...",
          isComplete: false,
          txHash: retrieveTxHash,
        });

        await waitForTransaction(retrieveTxHash, chain);
        updateStep(4, {
          status: "Successfully retrieved unused deposit",
          isComplete: true,
          txHash: retrieveTxHash,
        });
      } else {
        updateStep(4, {
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
  }, [smartWalletAddress, passkey, useAnvil, chain, isDelegateDisrupted, isImplementationDisrupted]);

  const handleRecover = async () => {
    try {
      setVerifying(true);
      setSteps([]);
      setIsVerified(false);
      addStep({
        status: "Starting account recovery...",
        isComplete: false,
      });

      // Create user's wallet client for signing
      const userWallet = createEOAClient(account, useAnvil);
      console.log("EOA account for signing:", {
        address: account.address,
        hasPrivateKey: !!account._privateKey,
      });

      const publicClient = createPublicClient({
        chain,
        transport: http(),
      });

      // Mark initial step as complete
      updateStep(0, {
        status: "Account recovery initialized",
        isComplete: true,
      });

      // Case 1: Only delegate is disrupted
      if (isDelegateDisrupted && !isImplementationDisrupted) {
        addStep({
          status: "Resetting delegate...",
          isComplete: false,
        });

        // Create authorization for the correct proxy template
        const authorization = await userWallet.signAuthorization({
          contractAddress: PROXY_TEMPLATE_ADDRESSES[useAnvil ? 'anvil' : 'odyssey'],
          sponsor: true,
          chainId: 0,
        });

        // Submit via relay endpoint
        const response = await fetch("/api/relay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "submit7702Auth",
            targetAddress: smartWalletAddress,
            authorizationList: [authorization],
          }, (_, value) => 
            typeof value === "bigint" ? value.toString() : value
          ),
        });

        if (!response.ok) {
          throw new Error("Failed to reset delegate");
        }

        const { hash } = await response.json();
        updateStep(1, {
          status: "Waiting for delegate reset transaction...",
          isComplete: false,
          txHash: hash,
        });

        await waitForTransaction(hash, chain);
        await checkState();
        updateStep(1, {
          status: "Successfully reset delegate",
          isComplete: true,
          txHash: hash,
        });
      }

      // Case 2: Only implementation is disrupted
      else if (!isDelegateDisrupted && isImplementationDisrupted) {
        addStep({
          status: "Resetting implementation to correct version...",
          isComplete: false,
        });

        // Get current implementation from storage
        const implementationSlotData = await publicClient.getStorageAt({
          address: smartWalletAddress,
          slot: ERC1967_IMPLEMENTATION_SLOT,
        });
        
        if (!implementationSlotData) {
          throw new Error("Failed to read implementation slot");
        }
        
        // Convert the storage data to an address (take last 20 bytes)
        const currentImplementation = `0x${implementationSlotData.slice(-40)}` as Address;
        console.log("Current implementation:", currentImplementation);

        updateStep(1, {
          status: "Reading current implementation state...",
          isComplete: true,
        });

        const nonce = await getNonceFromTracker(publicClient, smartWalletAddress);

        // Create the setImplementation hash
        const chainId = useAnvil ? localAnvil.id : odysseyTestnet.id;
        console.log("Chain ID:", chainId);
        const setImplementationHash = createSetImplementationHash(
          PROXY_TEMPLATE_ADDRESSES[useAnvil ? 'anvil' : 'odyssey'],
          NEW_IMPLEMENTATION_ADDRESS,
          "0x", // No initialization needed for reset
          nonce,
          currentImplementation,
          false, // allowCrossChainReplay
          BigInt(chainId)
        );

        // Sign the hash using the EOA
        const signature = await signSetImplementation(userWallet, setImplementationHash);

        updateStep(1, {
          status: "Preparing implementation reset transaction...",
          isComplete: true,
        });

        // Submit via relay endpoint
        const response = await fetch("/api/relay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "setImplementation",
            targetAddress: smartWalletAddress,
            signature,
          }, (_, value) => 
            typeof value === "bigint" ? value.toString() : value
          ),
        });

        if (!response.ok) {
          throw new Error("Failed to reset implementation");
        }

        const { hash } = await response.json();
        updateStep(1, {
          status: "Waiting for implementation reset transaction...",
          isComplete: false,
          txHash: hash,
        });

        await waitForTransaction(hash, chain);
        await checkState();
        updateStep(1, {
          status: "Successfully reset implementation",
          isComplete: true,
          txHash: hash,
        });
      }

      // Case 3: Both delegate and implementation are disrupted
      else if (isDelegateDisrupted && isImplementationDisrupted) {
        addStep({
          status: "Resetting both delegate and implementation...",
          isComplete: false,
        });

        // Create authorization for the correct proxy template
        const authorization = await userWallet.signAuthorization({
          contractAddress: PROXY_TEMPLATE_ADDRESSES[useAnvil ? 'anvil' : 'odyssey'],
          sponsor: true,
          chainId: 0,
        });

        // Get current implementation from storage
        const implementationSlotData = await publicClient.getStorageAt({
          address: smartWalletAddress,
          slot: ERC1967_IMPLEMENTATION_SLOT,
        });
        
        if (!implementationSlotData) {
          throw new Error("Failed to read implementation slot");
        }
        
        // Convert the storage data to an address (take last 20 bytes)
        const currentImplementation = `0x${implementationSlotData.slice(-40)}` as Address;
        
        const nonce = await getNonceFromTracker(publicClient, smartWalletAddress);

        // Create and sign the setImplementation hash
        const chainId = useAnvil ? localAnvil.id : odysseyTestnet.id;
        const setImplementationHash = createSetImplementationHash(
          PROXY_TEMPLATE_ADDRESSES[useAnvil ? 'anvil' : 'odyssey'],
          NEW_IMPLEMENTATION_ADDRESS,
          "0x", // No initialization needed for reset
          nonce,
          currentImplementation,
          false, // allowCrossChainReplay
          BigInt(chainId)
        );

        // Sign the hash using the EOA
        const signature = await signSetImplementation(userWallet, setImplementationHash);

        // Submit via relay endpoint using the upgradeEOA operation
        const response = await fetch("/api/relay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "upgradeEOA",
            targetAddress: smartWalletAddress,
            initArgs: "0x", // No initialization needed
            signature,
            authorizationList: [authorization],
          }, (_, value) => 
            typeof value === "bigint" ? value.toString() : value
          ),
        });

        if (!response.ok) {
          throw new Error("Failed to reset delegate and implementation");
        }

        const { hash } = await response.json();
        updateStep(1, {
          status: "Waiting for reset transaction...",
          isComplete: false,
          txHash: hash,
        });

        await waitForTransaction(hash, chain);
        await checkState();
        updateStep(1, {
          status: "Successfully reset delegate and implementation",
          isComplete: true,
          txHash: hash,
        });
      }

      onRecoveryComplete();
      setShowRecoveryModal(false);
      
      addStep({
        status: "Account recovered successfully",
        isComplete: true,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      addStep({
        status: "Recovery failed",
        isComplete: true,
        error: errorMessage,
      });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="flex flex-col items-center w-full max-w-5xl mx-auto mt-8">
      <button
        onClick={handleVerify}
        disabled={verifying}
        className="px-6 py-3 text-lg font-semibold text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed mb-8 w-64"
      >
        {verifying ? "..." : "Transact using passkey"}
      </button>

      <div className="w-full space-y-4">
        {steps.map((step, index) => (
          <StepDisplay key={index} step={step} useAnvil={useAnvil} />
        ))}
      </div>

      {isVerified && steps.every((step) => step.isComplete && !step.error) && (
        <div className="mt-8 text-center text-green-500 font-semibold text-lg">
          ✅ Successfully submitted a userOp with passkey owner!
          <div className="mt-4 text-base text-gray-400">
            You can submit another transaction using the button above.
          </div>
        </div>
      )}

      <RecoveryModal
        isOpen={showRecoveryModal}
        onClose={() => setShowRecoveryModal(false)}
        onRecover={handleRecover}
        delegateIssue={isDelegateDisrupted}
        implementationIssue={isImplementationDisrupted}
      />
    </div>
  );
}
