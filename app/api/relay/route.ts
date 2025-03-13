import { NextResponse } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http, type Hex, encodeFunctionData } from "viem";
import { odysseyTestnet } from "@/app/lib/chains";
import { eip7702Actions } from "viem/experimental";
import { localAnvil } from "../../lib/wallet-utils";
import { NEW_IMPLEMENTATION_ADDRESS, VALIDATOR_ADDRESS } from "../../lib/contracts";

// This runs on the server, so it's safe to access the private key
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY as Hex;
const PUBLIC_RELAYER_ADDRESS = process.env.NEXT_PUBLIC_RELAYER_ADDRESS;

if (!RELAYER_PRIVATE_KEY) {
  throw new Error("RELAYER_PRIVATE_KEY environment variable is required");
}

if (!PUBLIC_RELAYER_ADDRESS) {
  throw new Error(
    "NEXT_PUBLIC_RELAYER_ADDRESS environment variable is required"
  );
}

// Create relayer wallet once
const relayerAccount = privateKeyToAccount(RELAYER_PRIVATE_KEY);

// Verify the relayer address matches what's public
if (
  relayerAccount.address.toLowerCase() !== PUBLIC_RELAYER_ADDRESS.toLowerCase()
) {
  throw new Error("Relayer private key does not match public address");
}

const relayerWallet = createWalletClient({
  account: relayerAccount,
  chain: odysseyTestnet,
  transport: http(),
}).extend(eip7702Actions());

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { operation, targetAddress } = body;

    switch (operation) {
      case "fund": {
        const { value } = body;
        const hash = await relayerWallet.sendTransaction({
          to: targetAddress,
          value: BigInt(value),
        });
        return Response.json({ hash });
      }
      
      case "upgradeEOA": {
        const { initArgs, signature, authorizationList } = body;
        
        console.log("Received upgradeEOA request:", {
          targetAddress,
          hasAuthList: !!authorizationList,
          authListLength: authorizationList?.length,
          authDetails: authorizationList?.[0],
          hasInitArgs: !!initArgs,
          hasSignature: !!signature,
        });
        
        // Combined transaction that includes both the 7702 authorization and setImplementation call
        const hash = await relayerWallet.sendTransaction({
          to: targetAddress,
          data: encodeFunctionData({
            abi: [{
              type: "function",
              name: "setImplementation",
              inputs: [
                { name: "newImplementation", type: "address" },
                { name: "callData", type: "bytes" },
                { name: "validator", type: "address" },
                { name: "signature", type: "bytes" },
                { name: "allowCrossChainReplay", type: "bool" }
              ],
              outputs: [],
              stateMutability: "payable"
            }],
            functionName: "setImplementation",
            args: [
              NEW_IMPLEMENTATION_ADDRESS,
              initArgs,
              VALIDATOR_ADDRESS,
              signature,
              false
            ]
          }),
          authorizationList,
        });
        
        console.log("Submitted upgradeEOA transaction:", {
          hash,
          targetAddress,
          implementation: NEW_IMPLEMENTATION_ADDRESS,
          validator: VALIDATOR_ADDRESS,
        });
        
        return Response.json({ hash });
      }

      case "execute": {
        const { args } = body;
        const hash = await relayerWallet.writeContract({
          address: targetAddress,
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
          args: [args.target, BigInt(args.value), args.data],
        });
        return Response.json({ hash });
      }

      case "delegate": {
        const { authorizationList } = body;
        console.log("Received delegate request:", {
          targetAddress,
          hasAuthList: !!authorizationList,
          authListLength: authorizationList?.length,
          authDetails: authorizationList?.[0],
        });

        // Submit the authorization to delegate to a foreign address
        const hash = await relayerWallet.sendTransaction({
          to: targetAddress,
          value: BigInt(0),
          authorizationList,
        });
        
        return Response.json({ hash });
      }

      case "setForeignImplementation": {
        const { implementation } = body;
        
        // Call upgradeToAndCall directly on the EOA
        const hash = await relayerWallet.sendTransaction({
          to: targetAddress,
          value: BigInt(0),
          data: encodeFunctionData({
            abi: [{
              type: "function",
              name: "upgradeToAndCall",
              inputs: [
                { name: "newImplementation", type: "address" },
                { name: "data", type: "bytes" }
              ],
              outputs: [],
              stateMutability: "nonpayable"
            }],
            functionName: "upgradeToAndCall",
            args: [implementation, "0x"]
          })
        });
        
        return Response.json({ hash });
      }

      case "resetDelegate": {
        const { authorizationList } = body;
        
        // Submit the authorization to reset delegate back to relayer
        const hash = await relayerWallet.sendTransaction({
          to: targetAddress,
          value: BigInt(0),
          authorizationList,
        });
        
        return Response.json({ hash });
      }

      case "resetImplementation": {
        const { signature, authorizationList } = body;
        
        // Call setImplementation to reset to the correct implementation
        const hash = await relayerWallet.sendTransaction({
          to: targetAddress,
          value: BigInt(0),
          data: encodeFunctionData({
            abi: [{
              type: "function",
              name: "setImplementation",
              inputs: [
                { name: "newImplementation", type: "address" },
                { name: "callData", type: "bytes" },
                { name: "validator", type: "address" },
                { name: "signature", type: "bytes" },
                { name: "allowCrossChainReplay", type: "bool" }
              ],
              outputs: [],
              stateMutability: "payable"
            }],
            functionName: "setImplementation",
            args: [
              NEW_IMPLEMENTATION_ADDRESS,
              "0x", // No initialization needed for reset
              VALIDATOR_ADDRESS,
              signature,
              false
            ]
          }),
          authorizationList,
        });
        
        return Response.json({ hash });
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown operation: ${operation}` }),
          { status: 400 }
        );
    }
  } catch (error: any) {
    console.error("Relay error:", error);
    return new Response(
      JSON.stringify({ 
        error: error.message || "Internal server error",
        details: error.shortMessage || error.details || undefined
      }),
      { status: 500 }
    );
  }
}
