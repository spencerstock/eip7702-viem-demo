import {
  type Address,
  type Hex,
  createPublicClient,
  createWalletClient,
  http,
} from "viem";
import { odysseyTestnet } from "@/app/lib/chains";
import { EntryPointAddress, EntryPointAbi } from "@/app/lib/abi/EntryPoint";
import {
  submitUserOp,
  withdrawEntryPointDeposit,
  ensureEntryPointDeposit,
} from "@/app/lib/smart-account";
import { privateKeyToAccount } from "viem/accounts";
import type { UserOperation } from "viem/account-abstraction";
import { serializeBigInts, deserializeBigInts } from "@/app/lib/smart-account";

type StatusCallback = (status: string) => void;

export async function POST(request: Request) {
  const status: string[] = [];
  const addStatus = (msg: string) => {
    console.log(msg); // Log to server console
    status.push(msg);
  };

  try {
    // Parse request body
    const {
      smartWalletAddress,
      publicKey,
      userOp: serializedUserOp,
    } = await request.json();

    console.log("\n=== Backend: UserOp as received ===");
    console.log(JSON.stringify(serializedUserOp, null, 2));

    // Deserialize the userOp by converting string values back to BigInt
    const userOp = deserializeBigInts(serializedUserOp);

    console.log("\n=== Backend: UserOp after deserialization ===");
    console.log(JSON.stringify(serializeBigInts(userOp), null, 2));

    // Validate inputs
    if (!smartWalletAddress) {
      return new Response("Missing smartWalletAddress", { status: 400 });
    }
    if (!publicKey) {
      return new Response("Missing publicKey", { status: 400 });
    }
    if (!serializedUserOp) {
      return new Response("Missing userOp", { status: 400 });
    }

    // Split the concatenated public key into x and y coordinates (32 bytes each)
    const x = `0x${publicKey.slice(2, 66)}` as `0x${string}`; // First 32 bytes
    const y = `0x${publicKey.slice(66)}` as `0x${string}`; // Last 32 bytes

    addStatus("Checking if passkey is an owner...");

    // Create public client
    const publicClient = createPublicClient({
      chain: odysseyTestnet,
      transport: http(),
    });

    // First check if the passkey is an owner
    const isOwner = await publicClient.readContract({
      address: smartWalletAddress as Address,
      abi: [
        {
          type: "function",
          name: "isOwnerPublicKey",
          inputs: [
            { name: "x", type: "bytes32" },
            { name: "y", type: "bytes32" },
          ],
          outputs: [{ name: "", type: "bool" }],
          stateMutability: "view",
        },
      ],
      functionName: "isOwnerPublicKey",
      args: [x, y],
    });

    if (!isOwner) {
      return new Response(
        JSON.stringify({ isOwner, error: "Passkey is not an owner" }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }

    addStatus("✅ Passkey is a valid owner!");

    // Check initial balances
    const initialSmartWalletBalance = await publicClient.getBalance({
      address: smartWalletAddress,
    });
    const initialRelayerBalance = await publicClient.getBalance({
      address: process.env.NEXT_PUBLIC_RELAYER_ADDRESS as Address,
    });
    const initialEntryPointDeposit = (await publicClient.readContract({
      address: EntryPointAddress,
      abi: EntryPointAbi,
      functionName: "balanceOf",
      args: [smartWalletAddress],
    })) as bigint;

    addStatus(
      `Initial smart wallet balance: ${initialSmartWalletBalance.toString()} wei`
    );
    addStatus(
      `Initial relayer balance: ${initialRelayerBalance.toString()} wei`
    );
    addStatus(
      `Initial EntryPoint deposit: ${initialEntryPointDeposit.toString()} wei`
    );

    // If smart wallet balance is 0, fund it with 1 wei
    if (initialSmartWalletBalance === BigInt(0)) {
      addStatus("Smart wallet balance is 0, funding with 1 wei...");

      // Ensure relayer private key is available
      if (!process.env.RELAYER_PRIVATE_KEY) {
        throw new Error("Relayer private key not configured");
      }

      // Create wallet client for the relayer
      const relayer = privateKeyToAccount(
        process.env.RELAYER_PRIVATE_KEY as `0x${string}`
      );
      const walletClient = createWalletClient({
        account: relayer,
        chain: odysseyTestnet,
        transport: http(),
      });

      // Send 1 wei to the smart wallet
      const hash = await walletClient.sendTransaction({
        to: smartWalletAddress,
        value: BigInt(1),
      });

      addStatus(`Funding transaction submitted: ${hash}`);
      addStatus("Waiting for confirmation...");

      await publicClient.waitForTransactionReceipt({ hash });
      addStatus("Funding transaction confirmed");

      // Get updated balance
      const newBalance = await publicClient.getBalance({
        address: smartWalletAddress,
      });
      addStatus(`New smart wallet balance: ${newBalance.toString()} wei`);
    }

    // Submit the userOp
    try {
      // Ensure there's enough deposit for gas
      addStatus("Ensuring sufficient deposit in EntryPoint...");
      await ensureEntryPointDeposit({
        smartWalletAddress: smartWalletAddress as Address,
        amount: BigInt(1e16), // 0.01 ETH should be enough for gas costs
        onStatus: addStatus,
      });

      addStatus("Submitting userOp...");
      const { hash, userOpHash } = await submitUserOp({
        userOp: userOp,
        onStatus: addStatus,
      });
      addStatus(
        `UserOp submitted successfully! Hash: ${hash}, UserOpHash: ${userOpHash}`
      );
    } catch (error) {
      addStatus(
        `Error submitting userOp: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error; // Re-throw to be caught by outer try-catch
    }

    // Check final balances
    const finalSmartWalletBalance = await publicClient.getBalance({
      address: smartWalletAddress,
    });
    const finalRelayerBalance = await publicClient.getBalance({
      address: process.env.NEXT_PUBLIC_RELAYER_ADDRESS as Address,
    });

    addStatus(
      `Final smart wallet balance: ${finalSmartWalletBalance.toString()} wei`
    );
    addStatus(`Final relayer balance: ${finalRelayerBalance.toString()} wei`);
    addStatus(
      `Wei transferred to relayer: ${(
        initialSmartWalletBalance - finalSmartWalletBalance
      ).toString()}`
    );

    // Always attempt to withdraw deposit
    try {
      addStatus("Attempting to withdraw EntryPoint deposit...");
      const result = await withdrawEntryPointDeposit({
        smartWalletAddress: smartWalletAddress as Address,
        withdrawAddress: process.env.NEXT_PUBLIC_RELAYER_ADDRESS as Address,
        onStatus: addStatus,
      });
      if (result?.hash) {
        addStatus(`Withdrawal successful! Transaction hash: ${result.hash}`);
      }
    } catch (error) {
      addStatus(
        `Withdrawal failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    return new Response(JSON.stringify({ isOwner, status }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("Failed to verify passkey:", error);
    return new Response(
      JSON.stringify({
        isOwner: false,
        error: `Failed to verify passkey: ${
          error instanceof Error ? error.message : String(error)
        }`,
        status,
      }),
      { status: 500 }
    );
  }
}
