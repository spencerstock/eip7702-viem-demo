import { type Address } from "viem";

// Standard EntryPoint address (same across networks)
export const ENTRYPOINT_ADDRESS =
  "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789" as const;

// Network-specific proxy template addresses
export const PROXY_TEMPLATE_ADDRESSES: { [key: string]: Address } = {
  odyssey: "0xcA271A94dd66982180960B579de6B3213084D67A",
  anvil: "0x0000000000000000000000000000000000000000",
} as const;

// Validator contract address
export const VALIDATOR_ADDRESS = "0xA96fc9fA032e5f58E225D979f985D51BCb671eF8" as const;

// Implementation set typehash
export const IMPLEMENTATION_SET_TYPEHASH = "EIP7702ProxyImplementationSet(uint256 chainId,address proxy,uint256 nonce,address currentImplementation,address newImplementation,bytes callData,address validator)" as const;

// New CoinbaseSmartWallet implementation address
export const NEW_IMPLEMENTATION_ADDRESS = "0x3e0BecB45eBf7Bd1e3943b9521264Bc5B0bd8Ca9" as const;

// Zero address for current implementation
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

// Add NonceTracker address constant
export const NONCE_TRACKER_ADDRESS = "0x1e3C75E11F8c31ffe8BA28A648B1D58566df6d72" as const;
// Add ERC1967 implementation slot constant
export const ERC1967_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;

export const FOREIGN_DELEGATE = "0x5ee57314eFc8D76B9084BC6759A2152084392e18" as const; // old EIP7702Proxy version
// const FOREIGN_DELEGATE = "0x88da98F3fd0525FFB85D03D29A21E49f5d48491f" as const;

export const FOREIGN_IMPLEMENTATION = "0xbAaaB2feecd974717816FA5ac540D96ad12eb342" as const; // payable MockImplementation, no owner check on upgradeToAndCall
// const FOREIGN_IMPLEMENTATION = "0x3e0BecB45eBf7Bd1e3943b9521264Bc5B0bd8Ca9" as const; // new implementation

export const ERC1967_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;

// EIP-7702 magic prefix
export const MAGIC_PREFIX = "0xef0100" as const;
