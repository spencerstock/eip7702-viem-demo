# EIP-7702 Wallet Demo

A simple demo application showcasing EIP-7702 wallet creation and upgrades using viem. This demo allows you to create an EOA wallet, upgrade it to a `CoinbaseSmartWallet` using EIP-7702, and verify the upgrade was successful.

## Prerequisites

- Node.js and npm installed

## Testing with Odyssey Testnet

The Odyssey testnet already has the necessary contracts deployed. You'll just need to:

1. Clone and install the repository:

```bash
git clone git@github.com:amiecorso/eip7702-viem-demo.git
cd eip7702-viem-demo
npm install
```

2. Configure your environment:

```bash
cp .env.example .env
```

Add your relayer wallet credentials to `.env`:

```bash
# Required
RELAYER_PRIVATE_KEY=your_private_key_here
NEXT_PUBLIC_RELAYER_ADDRESS=your_public_address_here
```

3. Fund your relayer wallet with some [Odyssey testnet](https://hub.conduit.xyz/odyssey) ETH. Sepolia bridge [here](https://odyssey-fba0638ec5f46615.testnets.rollbridge.app/).

4. Start the development server:

```bash
npm run dev
```

## Usage

### Basic account creation and upgrade
Creates a new random EOA wallet and upgrades it to a `CoinbaseSmartWallet` using EIP-7702.

1. Click "Create new EOA Wallet" to generate a new wallet
2. Click "Upgrade EOA to Smart Wallet" to:
   - Sign and submit an authorization for the proxy contract while sending the EOA 1 wei
   - Initialize the smart wallet by adding a passkey as a new owner of the smart wallet
3. Click "Transact using passkey" to:
   - Confirm the passkey is an owner
   - Test controlling the smart wallet via the new passkey owner and user operations

### Account disruption and recovery
After creating a new wallet and upgrading via 7702, you can simulate the possible states of account disruption and recovery. You can simulate disruption of the delegate, ownership, and/or implementation pointer, and then attempt account recovery from the disruption when you try to transact with passkey.

1. Disrupt the 7702 delegate by clicking "7702-Delegate to Storage Eraser"
   - This will set the delegate to the a mock malicious contract, which has a function that can erase the nextOwnerIndex storage slot at the account
2. Disrupt the implementation by clicking "Set Foreign ERC-1967 Implementation"
   - This will set the ERC-1967 implementation to a simple mock ERC-1967-compliant contract
3. Disrupt the ownership by clicking "Erase Owner Storage"
   - This is only possible after the delegate has been disrupted to the storage eraser contract
   - This will set the nextOwnerIndex storage slot to 0, leaving the CoinbaseSmartWallet implementation vulnerable to arbitrary initialization
     if the implementation points to a CoinbaseSmartWallet.


## Network Details

### Odyssey Testnet

- RPC URL: https://odyssey.ithaca.xyz
- Chain ID: 911867
- Block Explorer: https://odyssey-explorer.ithaca.xyz


## Project Structure

- `app/lib/constants.ts`: Constants for the project, including contract addresses
- `app/lib/contract-utils.ts`: Utilities for interacting with contracts
- `app/lib/wallet-utils.ts`: Wallet creation and signing utilities
- `app/lib/relayer-utils.ts`: Utilities for relayer operations
- `app/lib/abi/`: Contract ABIs and addresses
- `app/components/`: React components for the UI
- `app/api/`: Backend API routes for relayer operations
