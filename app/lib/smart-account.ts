import {
  createPublicClient,
  http,
  parseEther,
  type Address,
  createWalletClient,
  type Hash,
  encodeFunctionData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  toCoinbaseSmartAccount,
} from "viem/account-abstraction";
import { odysseyTestnet } from "./chains";
import { EntryPointAddress, EntryPointAbi } from "./abi/EntryPoint";
import type { UserOperation } from "viem/account-abstraction";

// Type for status updates
type StatusCallback = (status: string) => void;

export async function getSmartAccountClient(
  smartWalletAddress: `0x${string}`,
) {
  if (!process.env.RELAYER_PRIVATE_KEY) {
    throw new Error("RELAYER_PRIVATE_KEY environment variable is required");
  }

  const publicClient = createPublicClient({
    chain: odysseyTestnet,
    transport: http(),
  });

  // Create the owner account from the relayer's private key
  const owner = privateKeyToAccount(
    process.env.RELAYER_PRIVATE_KEY as `0x${string}`
  );

  // Create and return the smart account client
  return toCoinbaseSmartAccount({
    client: publicClient,
    address: smartWalletAddress,
    owners: [owner],
  });
}

export async function createAndSignUserOp({
  smartAccount,
  target,
  value,
  data = "0x",
  onStatus,
}: {
  smartAccount: Awaited<ReturnType<typeof toCoinbaseSmartAccount>>;
  target: Address;
  value: bigint;
  data?: `0x${string}`;
  onStatus?: StatusCallback;
}): Promise<UserOperation> {
  onStatus?.("Preparing userOperation...");

  // Get the encoded call data
  const callData = await smartAccount.encodeCalls([
    {
      to: target,
      value,
      data,
    },
  ]);

  // Get the nonce
  const nonce = await smartAccount.getNonce();

  // Construct the userOp with reasonable gas values
  const unsignedUserOp = {
    sender: smartAccount.address,
    nonce,
    initCode: "0x" as const,
    callData,
    callGasLimit: BigInt(100000),
    verificationGasLimit: BigInt(100000),
    preVerificationGas: BigInt(50000),
    maxFeePerGas: parseEther("0.000000003"), // 3 gwei
    maxPriorityFeePerGas: parseEther("0.000000002"), // 2 gwei
    paymasterAndData: "0x" as const,
    signature: "0x" as const,
  } as const;

  // Sign the userOp
  onStatus?.("Signing userOperation...");
  const signature = await smartAccount.signUserOperation(unsignedUserOp);

  // Construct the final signed userOp
  const signedUserOp = {
    ...unsignedUserOp,
    signature,
  };

  onStatus?.("UserOperation prepared and signed");
  return signedUserOp;
}

export async function ensureEntryPointDeposit({
  smartWalletAddress,
  amount,
  onStatus,
}: {
  smartWalletAddress: Address;
  amount: bigint;
  onStatus?: StatusCallback;
}) {
  if (!process.env.RELAYER_PRIVATE_KEY) {
    throw new Error("RELAYER_PRIVATE_KEY environment variable is required");
  }

  const publicClient = createPublicClient({
    chain: odysseyTestnet,
    transport: http(),
  });

  onStatus?.("Checking EntryPoint deposit...");

  // Check current deposit
  const currentDeposit = (await publicClient.readContract({
    address: EntryPointAddress,
    abi: EntryPointAbi,
    functionName: "balanceOf",
    args: [smartWalletAddress],
  })) as bigint;

  onStatus?.(`Current deposit: ${currentDeposit.toString()} wei`);

  if (currentDeposit >= amount) {
    onStatus?.("Sufficient deposit already exists");
    return; // Already has enough deposit
  }

  // Need to deposit more
  const depositAmount = amount - currentDeposit;
  onStatus?.(
    `Depositing additional ${depositAmount.toString()} wei to EntryPoint...`
  );

  // Create wallet client for the relayer
  const relayer = privateKeyToAccount(
    process.env.RELAYER_PRIVATE_KEY as `0x${string}`
  );
  const walletClient = createWalletClient({
    account: relayer,
    chain: odysseyTestnet,
    transport: http(),
  });

  // Deposit to EntryPoint
  const hash = await walletClient.writeContract({
    address: EntryPointAddress,
    abi: EntryPointAbi,
    functionName: "depositTo",
    args: [smartWalletAddress],
    value: depositAmount,
  });

  onStatus?.(`Deposit transaction hash: ${hash}`);
  onStatus?.("Waiting for deposit confirmation...");

  await publicClient.waitForTransactionReceipt({ hash });
  onStatus?.("Deposit confirmed");
}

export async function submitUserOp({
  userOp,
  onStatus,
}: {
  userOp: UserOperation;
  onStatus?: StatusCallback;
}) {
  if (!process.env.NEXT_PUBLIC_RELAYER_ADDRESS) {
    throw new Error(
      "NEXT_PUBLIC_RELAYER_ADDRESS environment variable is required"
    );
  }

  // Debug log the userOp
  console.log("Raw UserOp:", userOp);
  console.log("UserOp fields:", {
    sender: userOp?.sender ?? "undefined",
    nonce: userOp?.nonce ? userOp.nonce.toString() : "undefined",
    initCode: userOp?.initCode ?? "undefined",
    callData: userOp?.callData ?? "undefined",
    callGasLimit: userOp?.callGasLimit
      ? userOp.callGasLimit.toString()
      : "undefined",
    verificationGasLimit: userOp?.verificationGasLimit
      ? userOp.verificationGasLimit.toString()
      : "undefined",
    preVerificationGas: userOp?.preVerificationGas
      ? userOp.preVerificationGas.toString()
      : "undefined",
    maxFeePerGas: userOp?.maxFeePerGas
      ? userOp.maxFeePerGas.toString()
      : "undefined",
    maxPriorityFeePerGas: userOp?.maxPriorityFeePerGas
      ? userOp.maxPriorityFeePerGas.toString()
      : "undefined",
    signature: userOp?.signature ?? "undefined",
  });

  // Create clients
  const publicClient = createPublicClient({
    chain: odysseyTestnet,
    transport: http(),
  });

  const relayer = privateKeyToAccount(
    process.env.RELAYER_PRIVATE_KEY as `0x${string}`
  );
  const walletClient = createWalletClient({
    account: relayer,
    chain: odysseyTestnet,
    transport: http(),
  });

  onStatus?.("Submitting userOperation to EntryPoint...");

  // Get the userOpHash for monitoring
  const userOpHash = (await publicClient.readContract({
    address: EntryPointAddress,
    abi: EntryPointAbi,
    functionName: "getUserOpHash",
    args: [userOp],
  })) as Hash;

  onStatus?.(`UserOperation hash: ${userOpHash}`);

  // Submit the userOp to the EntryPoint
  const hash = await walletClient.writeContract({
    address: EntryPointAddress,
    abi: EntryPointAbi,
    functionName: "handleOps",
    args: [[userOp], process.env.NEXT_PUBLIC_RELAYER_ADDRESS as `0x${string}`],
  });

  onStatus?.(`Transaction hash: ${hash}`);

  // Wait for the transaction to be mined
  onStatus?.("Waiting for transaction confirmation...");
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  // Check for UserOperationEvent in the logs
  const userOpEvent = receipt.logs.find(
    (log) =>
      log.address.toLowerCase() === EntryPointAddress.toLowerCase() &&
      log.topics[0] ===
        "0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f" // UserOperationEvent topic
  );

  if (!userOpEvent) {
    throw new Error("UserOperation execution failed");
  }

  onStatus?.("UserOperation successfully executed");
  return { hash, userOpHash };
}

export async function withdrawEntryPointDeposit({
  smartWalletAddress,
  withdrawAddress,
  onStatus,
}: {
  smartWalletAddress: Address;
  withdrawAddress: Address;
  onStatus?: StatusCallback;
}) {
  if (!process.env.RELAYER_PRIVATE_KEY) {
    throw new Error("RELAYER_PRIVATE_KEY environment variable is required");
  }

  const publicClient = createPublicClient({
    chain: odysseyTestnet,
    transport: http(),
  });

  // Check current deposit
  onStatus?.("Checking current deposit via balanceOf...");
  onStatus?.(`Smart wallet address: ${smartWalletAddress}`);
  onStatus?.(`Withdraw to address: ${withdrawAddress}`);
  onStatus?.(`EntryPoint address: ${EntryPointAddress}`);

  const currentDeposit = (await publicClient.readContract({
    address: EntryPointAddress,
    abi: EntryPointAbi,
    functionName: "balanceOf",
    args: [smartWalletAddress],
  })) as bigint;

  onStatus?.(
    `balanceOf result: ${currentDeposit.toString()} wei (${
      Number(currentDeposit) / 1e18
    } ETH)`
  );

  if (currentDeposit === BigInt(0)) {
    onStatus?.("No deposit to withdraw");
    return;
  }

  // Double check the deposit info
  onStatus?.("Getting detailed deposit info...");
  const depositInfo = (await publicClient.readContract({
    address: EntryPointAddress,
    abi: EntryPointAbi,
    functionName: "getDepositInfo",
    args: [smartWalletAddress],
  })) as {
    deposit: bigint;
    staked: boolean;
    stake: bigint;
    unstakeDelaySec: bigint;
    withdrawTime: bigint;
  };

  onStatus?.("Deposit info:");
  onStatus?.(
    `- Deposit: ${depositInfo.deposit.toString()} wei (${
      Number(depositInfo.deposit) / 1e18
    } ETH)`
  );
  onStatus?.(`- Staked: ${depositInfo.staked}`);
  onStatus?.(
    `- Stake: ${depositInfo.stake.toString()} wei (${
      Number(depositInfo.stake) / 1e18
    } ETH)`
  );
  onStatus?.(
    `- Unstake delay: ${depositInfo.unstakeDelaySec.toString()} seconds`
  );
  onStatus?.(`- Withdraw time: ${depositInfo.withdrawTime.toString()}`);

  const withdrawableAmount = depositInfo.deposit;
  if (withdrawableAmount === BigInt(0)) {
    onStatus?.("No withdrawable amount available");
    return;
  }

  // Withdraw the full amount
  onStatus?.(
    `Attempting to withdraw full deposit: ${withdrawableAmount.toString()} wei (${
      Number(withdrawableAmount) / 1e18
    } ETH)`
  );

  try {
    // Create wallet client for the relayer
    const relayer = privateKeyToAccount(
      process.env.RELAYER_PRIVATE_KEY as `0x${string}`
    );
    onStatus?.(`Relayer address: ${relayer.address}`);

    const walletClient = createWalletClient({
      account: relayer,
      chain: odysseyTestnet,
      transport: http(),
    });

    // Get the encoded call data for withdrawTo
    onStatus?.("Encoding withdrawTo calldata...");
    try {
      // Encode the withdrawTo call without simulation
      const withdrawCalldata = encodeFunctionData({
        abi: EntryPointAbi,
        functionName: "withdrawTo",
        args: [withdrawAddress, withdrawableAmount],
      });
      onStatus?.(`Encoded withdrawTo calldata: ${withdrawCalldata}`);

      // Now simulate the execute call on the smart wallet
      onStatus?.("Simulating execute call on smart wallet...");
      const executeSimulation = await publicClient.simulateContract({
        address: smartWalletAddress,
        abi: [
          {
            type: "function",
            name: "execute",
            inputs: [
              { name: "target", type: "address" },
              { name: "value", type: "uint256" },
              { name: "data", type: "bytes" },
            ],
            outputs: [],
            stateMutability: "payable",
          },
        ],
        functionName: "execute",
        args: [EntryPointAddress, BigInt(0), withdrawCalldata],
        account: relayer.address,
      });
      onStatus?.("Simulation successful");
      onStatus?.("Execute simulation details:");
      onStatus?.(`- Target: ${smartWalletAddress}`);
      onStatus?.(`- From: ${relayer.address}`);
      onStatus?.(
        `- Call: execute(${EntryPointAddress}, 0, ${withdrawCalldata})`
      );

      // Have the relayer call execute on the smart wallet
      onStatus?.(`Calling execute on smart wallet ${smartWalletAddress}...`);
      onStatus?.("Execute call details:");
      onStatus?.(`- Target: ${EntryPointAddress}`);
      onStatus?.(`- Value: 0`);
      onStatus?.(`- Data: ${withdrawCalldata}`);

      const hash = await walletClient.writeContract({
        address: smartWalletAddress,
        abi: [
          {
            type: "function",
            name: "execute",
            inputs: [
              { name: "target", type: "address" },
              { name: "value", type: "uint256" },
              { name: "data", type: "bytes" },
            ],
            outputs: [],
            stateMutability: "payable",
          },
        ],
        functionName: "execute",
        args: [EntryPointAddress, BigInt(0), withdrawCalldata],
      });

      onStatus?.(`Withdrawal transaction submitted: ${hash}`);
      onStatus?.("Waiting for confirmation...");

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      onStatus?.(`Transaction confirmed in block ${receipt.blockNumber}`);
      onStatus?.(`Transaction status: ${receipt.status}`);
      if (receipt.logs.length > 0) {
        onStatus?.("Transaction logs:");
        receipt.logs.forEach((log, i) => {
          onStatus?.(`Log ${i}:`);
          onStatus?.(`  Address: ${log.address}`);
          onStatus?.(`  Topics: ${log.topics.join(", ")}`);
          onStatus?.(`  Data: ${log.data}`);
        });
      }

      // Get final deposit info to verify withdrawal
      onStatus?.("Getting final deposit info...");
      const finalDepositInfo = (await publicClient.readContract({
        address: EntryPointAddress,
        abi: EntryPointAbi,
        functionName: "getDepositInfo",
        args: [smartWalletAddress],
      })) as {
        deposit: bigint;
        staked: boolean;
        stake: bigint;
        unstakeDelaySec: bigint;
        withdrawTime: bigint;
      };

      onStatus?.("Final deposit info:");
      onStatus?.(
        `- Deposit: ${finalDepositInfo.deposit.toString()} wei (${
          Number(finalDepositInfo.deposit) / 1e18
        } ETH)`
      );
      onStatus?.(`- Staked: ${finalDepositInfo.staked}`);
      onStatus?.(
        `- Stake: ${finalDepositInfo.stake.toString()} wei (${
          Number(finalDepositInfo.stake) / 1e18
        } ETH)`
      );

      if (finalDepositInfo.deposit === BigInt(0)) {
        onStatus?.("Withdrawal successful - deposit is now zero!");
        return { hash };
      } else {
        throw new Error(
          `Withdrawal may have failed - deposit is still ${finalDepositInfo.deposit.toString()} wei`
        );
      }
    } catch (simError) {
      onStatus?.("Simulation failed with error:");
      onStatus?.(
        `${simError instanceof Error ? simError.message : String(simError)}`
      );
      if (simError instanceof Error && simError.cause) {
        onStatus?.(`Error cause: ${JSON.stringify(simError.cause, null, 2)}`);
      }
      throw simError;
    }
  } catch (error) {
    onStatus?.("Withdrawal failed with error:");
    onStatus?.(`${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.cause) {
      onStatus?.(`Error cause: ${JSON.stringify(error.cause, null, 2)}`);
    }
    throw error;
  }
}

// Helper function to serialize BigInt values in an object
export function serializeBigInts(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (typeof obj === "bigint") {
    return obj.toString();
  }
  if (Array.isArray(obj)) {
    return obj.map(serializeBigInts);
  }
  if (typeof obj === "object") {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = serializeBigInts(value);
    }
    return result;
  }
  return obj;
}

// Helper function to deserialize BigInt values in an object
export function deserializeBigInts(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (typeof obj === "string" && /^\d+$/.test(obj)) {
    return BigInt(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(deserializeBigInts);
  }
  if (typeof obj === "object") {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = deserializeBigInts(value);
    }
    return result;
  }
  return obj;
}
