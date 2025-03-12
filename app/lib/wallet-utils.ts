import {
  createWalletClient,
  http,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  WalletClient,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";
import { eip7702Actions } from "viem/experimental";
import { secp256k1 } from "@noble/curves/secp256k1";
import { hexToBytes } from "@noble/curves/abstract/utils";
import { keccak256 as keccak256Crypto } from "ethereum-cryptography/keccak";
import { odysseyTestnet } from "./chains";
import { 
  IMPLEMENTATION_SET_TYPEHASH, 
  VALIDATOR_ADDRESS,
} from "./contracts";

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

// Add a type for our extended account that includes the private key
export type ExtendedAccount = ReturnType<typeof privateKeyToAccount> & {
  _privateKey: Hex;
};

export async function getRelayerWalletClient(useAnvil = true) {
  if (useAnvil) {
    // For Anvil, we can still use the local account
    const privateKey = ANVIL_RELAYER_PRIVATE_KEY as Hex;
    const relayerAccount = privateKeyToAccount(privateKey);
    return createWalletClient({
      account: relayerAccount,
      chain: localAnvil,
      transport: http(),
    }).extend(eip7702Actions());
  }

  // For non-Anvil, return a proxy that calls our API
  return {
    account: {
      // Use the public relayer address
      address: process.env.NEXT_PUBLIC_RELAYER_ADDRESS as `0x${string}`,
    },
    async sendTransaction({
      to,
      value,
      authorizationList,
    }: {
      to: `0x${string}`;
      value: bigint;
      authorizationList: any[];
    }) {
      const response = await fetch("/api/relay", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to,
          value: value.toString(),
          authorizationList,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to relay transaction");
      }

      const { hash } = await response.json();
      return hash as `0x${string}`;
    },
  };
}

export function createEOAClient(account: ExtendedAccount, useAnvil = true) {
  // Create the wallet client with the extended account to get access to private key
  return createWalletClient({
    account,
    chain: useAnvil ? localAnvil : odysseyTestnet,
    transport: http(),
  }).extend(eip7702Actions());
}

export async function createEOAWallet(): Promise<ExtendedAccount> {
  // Generate a random private key
  const privateKey = `0x${crypto
    .getRandomValues(new Uint8Array(32))
    .reduce(
      (str, byte) => str + byte.toString(16).padStart(2, "0"),
      ""
    )}` as Hex;
  const account = privateKeyToAccount(privateKey);
  return {
    ...account,
    _privateKey: privateKey,
  };
}

export function encodeInitializeArgs(
  owners: (Hex | { publicKey: Hex })[]
): Hex {
  // First encode each owner - either an address or a WebAuthn public key
  const encodedOwners = owners.map((owner) => {
    if (typeof owner === "string") {
      // Regular address
      return encodeAbiParameters([{ type: "address" }], [owner]);
    } else {
      // WebAuthn public key - encode as bytes32[2] for x and y coordinates
      const pubKeyHex = owner.publicKey.slice(2); // remove 0x prefix
      const x = `0x${pubKeyHex.slice(0, 64)}` as Hex;
      const y = `0x${pubKeyHex.slice(64)}` as Hex;
      return encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }],
        [x, y]
      );
    }
  });

  // Encode the function call using encodeFunctionData
  return encodeFunctionData({
    abi: [{
      type: 'function',
      name: 'initialize',
      inputs: [{ type: 'bytes[]', name: 'owners' }],
      outputs: [],
      stateMutability: 'payable'
    }],
    functionName: 'initialize',
    args: [encodedOwners]
  });
}

export function createSetImplementationHash(
  proxyAddr: Hex,
  newImplementation: Hex,
  callData: Hex,
  nonce: bigint,
  currentImplementation: Hex,
  allowCrossChainReplay: boolean,
  chainId: bigint
): Hex {
  // First hash the calldata
  const callDataHash = keccak256(callData);

  // First compute the typehash
  const typeHash = keccak256(
    Buffer.from(IMPLEMENTATION_SET_TYPEHASH, 'utf-8')
  );

  // Construct the hash using the typehash
  const encodedData = encodeAbiParameters(
    [
      { type: "bytes32" },  // typehash
      { type: "uint256" },  // chainId
      { type: "address" },  // proxy
      { type: "uint256" },  // nonce
      { type: "address" },  // currentImplementation
      { type: "address" },  // newImplementation
      { type: "bytes32" },  // keccak256(callData)
      { type: "address" },  // validator
    ],
    [
      typeHash,
      allowCrossChainReplay ? BigInt(0) : chainId,
      proxyAddr,
      nonce,
      currentImplementation,
      newImplementation,
      callDataHash,
      VALIDATOR_ADDRESS,
    ]
  );

  return keccak256(encodedData);
}

export async function signSetImplementation(
  walletClient: WalletClient,
  hash: Hex
): Promise<Hex> {
  if (!walletClient.account) {
    throw new Error("Wallet client has no account");
  }

  // Get the private key from our extended account
  const privateKeyBytes = hexToBytes(
    (walletClient.account as ExtendedAccount)._privateKey.slice(2)
  );

  // Sign the hash (without any Ethereum prefix)
  const hashBytes = hexToBytes(hash.slice(2));
  const signature = secp256k1.sign(hashBytes, privateKeyBytes);

  // Get r, s, v values
  const r = signature.r.toString(16).padStart(64, "0");
  const s = signature.s.toString(16).padStart(64, "0");
  const v = signature.recovery + 27;

  // Pack the signature
  const packedSignature = `0x${r}${s}${v.toString(16)}` as Hex;

  return packedSignature;
}
