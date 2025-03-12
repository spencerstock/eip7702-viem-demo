import { type Address } from "viem";

// Standard EntryPoint address (same across networks)
export const ENTRYPOINT_ADDRESS =
  "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789" as const;

// Network-specific proxy template addresses
export const PROXY_TEMPLATE_ADDRESSES: { [key: string]: Address } = {
  odyssey: "0xcA271A94dd66982180960B579de6B3213084D67A",
  anvil: "0x0000000000000000000000000000000000000000", // Keep Anvil address for local testing
} as const;

// Validator contract address
export const VALIDATOR_ADDRESS = "0xA96fc9fA032e5f58E225D979f985D51BCb671eF8" as const;

// Implementation set typehash
export const IMPLEMENTATION_SET_TYPEHASH = "EIP7702ProxyImplementationSet(uint256 chainId,address proxy,uint256 nonce,address currentImplementation,address newImplementation,bytes callData,address validator)" as const;

// New CoinbaseSmartWallet implementation address
export const NEW_IMPLEMENTATION_ADDRESS = "0x3e0BecB45eBf7Bd1e3943b9521264Bc5B0bd8Ca9" as const;

// Zero address for current implementation
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
