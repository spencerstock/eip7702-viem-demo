import {
  createWalletClient,
  http,
  encodePacked,
  keccak256,
  encodeAbiParameters,
  recoverMessageAddress,
  toBytes,
  WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { type Hex } from "viem";
import { anvil, baseSepolia } from "viem/chains";
import { eip7702Actions } from "viem/experimental";
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes } from "@noble/curves/abstract/utils";
import { keccak256 as keccak256Crypto } from "ethereum-cryptography/keccak";

// Configure anvil chain with the correct URL
export const localAnvil = {
  ...anvil,
  rpcUrls: {
    default: {
      http: ["http://127.0.0.1:8545"],
    },
    public: {
      http: ["http://127.0.0.1:8545"],
    },
  },
} as const;

// Anvil's first pre-funded account
export const ANVIL_RELAYER_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export async function getRelayerWalletClient(useAnvil = true) {
  let privateKey: Hex;
  let chain;

  if (useAnvil) {
    // Use Anvil's pre-funded account
    privateKey = ANVIL_RELAYER_PRIVATE_KEY as Hex;
    chain = localAnvil;
  } else {
    // Use environment variable for testnet
    if (!process.env.RELAYER_PRIVATE_KEY) {
      throw new Error(
        "RELAYER_PRIVATE_KEY environment variable is required for non-Anvil networks"
      );
    }
    privateKey = process.env.RELAYER_PRIVATE_KEY as Hex;
    chain = baseSepolia;
  }

  const relayerAccount = privateKeyToAccount(privateKey);

  const relayerWallet = createWalletClient({
    account: relayerAccount,
    chain,
    transport: http(),
  }).extend(eip7702Actions());

  return relayerWallet;
}

export function createEOAClient(
  account: ReturnType<typeof privateKeyToAccount>,
  useAnvil = true
) {
  return createWalletClient({
    account,
    chain: useAnvil ? localAnvil : baseSepolia,
    transport: http(),
    key: account.address,
  }).extend(eip7702Actions());
}

// Known test values from the working Solidity example
const ANVIL_EOA = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const ANVIL_EOA_PK =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ANVIL_NEW_OWNER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const PROXY_ADDRESS = "0x2d95f129bCEbD5cF7f395c7B34106ac1DCfb0CA9";

export function createEOAWallet() {
  // Use the known Anvil account instead of generating a random one
  return privateKeyToAccount(ANVIL_EOA_PK as Hex);

  // Original random generation code commented out
  // const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  // const privateKey = `0x${Array.from(randomBytes)
  //   .map((b) => b.toString(16).padStart(2, "0"))
  //   .join("")}` as const;
  // return privateKeyToAccount(privateKey);
}

export function encodeInitializeArgs(ownerAddress: Hex): Hex {
  console.log("\nSignature Generation Details:");
  console.log("----------------------------");
  console.log("New owner address:", ownerAddress);

  // First encode the owner address
  const encodedOwner = encodeAbiParameters(
    [{ type: "address" }],
    [ownerAddress]
  );
  console.log("New owner encoded:", encodedOwner);

  // Create an array with the single encoded owner
  const owners = [encodedOwner];

  // Then encode the array of encoded owners
  const initArgs = encodeAbiParameters([{ type: "bytes[]" }], [owners]);
  console.log("Init args array encoded:", initArgs);

  return initArgs;
}

export function createInitializeHash(proxyAddr: Hex, initArgs: Hex): Hex {
  console.log("\nRaw values for hash:");
  console.log("  - proxyAddr:", proxyAddr);
  console.log("  - initArgs:", initArgs);

  // ABI encode the proxy address and init args
  const abiEncoded = encodeAbiParameters(
    [
      { name: "proxyAddr", type: "address" },
      { name: "initArgs", type: "bytes" },
    ],
    [proxyAddr, initArgs]
  );
  console.log("ABI encoded (proxyAddr, initArgs):", abiEncoded);

  // Convert hex string to Uint8Array for keccak256
  const abiEncodedBytes = hexToBytes(abiEncoded.slice(2));
  const hashBytes = keccak256Crypto(abiEncodedBytes);
  const hash = `0x${Buffer.from(hashBytes).toString("hex")}` as Hex;
  console.log("Init hash (keccak256):", hash);

  return hash;
}

// Create a raw signature without Ethereum prefix
export async function signInitialization(
  walletClient: WalletClient,
  hash: Hex
): Promise<Hex> {
  console.log("\nSignature Generation Details:");
  console.log("----------------------------");

  // Convert the private key to bytes
  const privateKeyBytes = hexToBytes(ANVIL_EOA_PK.slice(2));

  // Sign the hash (without any Ethereum prefix)
  const hashBytes = hexToBytes(hash.slice(2));
  const signature = secp256k1.sign(hashBytes, privateKeyBytes);

  // Get r, s, v values
  const r = signature.r.toString(16).padStart(64, "0");
  const s = signature.s.toString(16).padStart(64, "0");
  const v = signature.recovery + 27;

  console.log("\nSignature Components:");
  console.log("v:", v);
  console.log("r: 0x" + r);
  console.log("s: 0x" + s);

  // Pack the signature
  const packedSignature = `0x${r}${s}${v.toString(16)}` as Hex;
  console.log("\nFinal signature (packed r,s,v):", packedSignature);

  // Verify the signature
  const recoveredPubKey = secp256k1.Signature.fromCompact(
    signature.toCompactRawBytes()
  )
    .addRecoveryBit(signature.recovery)
    .recoverPublicKey(hashBytes);
  const recoveredAddress = publicKeyToAddress(
    recoveredPubKey.toRawBytes(false)
  );

  console.log("\nSignature Recovery:");
  console.log("EOA address (expected signer):", ANVIL_EOA);
  console.log("Recovered address:", recoveredAddress);

  return packedSignature;
}

// Helper function to convert public key to address
function publicKeyToAddress(publicKey: Uint8Array): string {
  // Remove the first byte (0x04) which indicates uncompressed public key
  const hashInput = publicKey.slice(1);
  // Take the last 20 bytes of the keccak256 hash
  const address = keccak256Crypto(hashInput).slice(-20);
  return `0x${Buffer.from(address).toString("hex")}`;
}
