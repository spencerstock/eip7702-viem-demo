// *************** Contract addresses ***************

// EIP7702Proxy
export const EIP7702PROXY_TEMPLATE_ADDRESS = "0x7702cb554e6bFb442cb743A7dF23154544a7176C" as const;

// NonceTracker used by EIP7702Proxy
export const NONCE_TRACKER_ADDRESS = "0xD0Ff13c28679FDd75Bc09c0a430a0089bf8b95a8" as const;

// DefaultReceiver
export const DEFAULT_RECEIVER_ADDRESS = "0x2a8010A9D71D2a5AEA19D040F8b4797789A194a9" as const;

// Validator contract address, validates CBSW_IMPLEMENTATION_ADDRESS
export const VALIDATOR_ADDRESS = "0x79A33f950b90C7d07E66950daedf868BD0cDcF96" as const;

// CoinbaseSmartWallet implementation address
export const CBSW_IMPLEMENTATION_ADDRESS = "0x000100abaad02f1cfC8Bbe32bD5a564817339E72" as const;

// A mock UUPSUpgradeable implementation
export const FOREIGN_1967_IMPLEMENTATION = "0x011056384Cb0C3F6B999A65d9f664a835961FFe3" as const;

// MultiOwnableStorageEraser has function that can erase nextOwnerIndex storage slot
export const STORAGE_ERASER_ADDRESS = "0xf88cBE56c3b636747AD8FF21890A6B96954eE5E8" as const;

// Standard EntryPoint address (same across networks)
export const ENTRYPOINT_ADDRESS = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789" as const;

// Zero address
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

// *************** Contract constants ***************

// Implementation set typehash
export const IMPLEMENTATION_SET_TYPEHASH = "EIP7702ProxyImplementationSet(uint256 chainId,address proxy,uint256 nonce,address currentImplementation,address newImplementation,bytes callData,address validator,uint256 expiry)" as const;

// ERC1967 implementation slot storage location
export const ERC1967_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;

// Next owner index storage slot (keccak256("nextOwnerIndex"))
export const NEXT_OWNER_INDEX_SLOT = "0x97e2c6aad4ce5d562ebfaa00db6b9e0fb66ea5d8162ed5b243f51a2e03086f00" as const;

// EIP-7702 magic prefix
export const MAGIC_PREFIX = "0xef0100" as const;
