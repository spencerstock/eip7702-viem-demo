import { type Address } from "viem";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { localAnvil } from "@/app/lib/wallet-utils";
import { odysseyTestnet } from "@/app/lib/chains";

export async function POST(request: Request) {
  try {
    // Get request data
    const body = await request.json();
    console.log("Request body:", body);

    const { smartWalletAddress, x, y } = body;

    // Validate inputs
    if (!smartWalletAddress) {
      return new Response("Missing smartWalletAddress", { status: 400 });
    }
    if (!x) {
      return new Response("Missing x coordinate", { status: 400 });
    }
    if (!y) {
      return new Response("Missing y coordinate", { status: 400 });
    }

    console.log("Extracted values:");
    console.log("smartWalletAddress:", smartWalletAddress);
    console.log("x:", x);
    console.log("y:", y);

    // Ensure relayer private key is available
    if (!process.env.RELAYER_PRIVATE_KEY) {
      return new Response("Relayer private key not configured", {
        status: 500,
      });
    }

    // Create wallet client for the relayer
    const relayer = privateKeyToAccount(
      process.env.RELAYER_PRIVATE_KEY as `0x${string}`
    );

    const useAnvil = process.env.NEXT_PUBLIC_USE_ANVIL === "true";
    const walletClient = createWalletClient({
      account: relayer,
      chain: useAnvil ? localAnvil : odysseyTestnet,
      transport: http(),
    });

    // Call addOwnerPublicKey on the smart wallet
    const hash = await walletClient.writeContract({
      address: smartWalletAddress as Address,
      abi: [
        {
          type: "function",
          name: "addOwnerPublicKey",
          inputs: [
            { name: "x", type: "bytes32" },
            { name: "y", type: "bytes32" },
          ],
          outputs: [],
          stateMutability: "nonpayable",
        },
      ],
      functionName: "addOwnerPublicKey",
      args: [x, y],
    });

    return new Response(JSON.stringify({ hash }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("Failed to register passkey:", error);
    return new Response(
      `Failed to register passkey: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { status: 500 }
    );
  }
}
