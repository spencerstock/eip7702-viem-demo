# EIP-7702 Wallet Demo

A simple demo application showcasing EIP-7702 wallet creation and upgrades using viem. This demo allows you to create an EOA wallet, upgrade it to a `CoinbaseSmartWallet` using EIP-7702, and verify the upgrade was successful.

## Prerequisites

- Node.js and npm installed
- [Foundry](https://book.getfoundry.sh/getting-started/installation) installed for Anvil testing

## Testing with Odyssey Testnet

The Odyssey testnet already has the necessary contracts deployed. You'll just need to:

1. Clone and install the repository:

```bash
git clone <your-repo-url>
cd <your-repo-name>
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

3. Fund your relayer wallet with some Odyssey testnet ETH

4. Start the development server:

```bash
npm run dev
```

## Usage

1. Click "Create new EOA Wallet" to generate a new wallet
2. Click "Upgrade EOA to Smart Wallet" to:
   - Sign and submit an authorization for the proxy contract while sending the EOA 1 wei
   - Initialize the smart wallet by adding the relayer as a new owner of the smart wallet
3. Click "Verify Ownership" to:
   - Confirm the relayer is the owner
   - Test executing transactions by the new relayer owner via the `execute` function of the smart wallet

## Network Details

### Odyssey Testnet

- RPC URL: https://odyssey.ithaca.xyz
- Chain ID: 911867
- Block Explorer: https://odyssey-explorer.ithaca.xyz
- EIP-7702 Proxy Template: 0x5ee57314eFc8D76B9084BC6759A2152084392e18

## Testing with Anvil (Local Development)

> ℹ️ Testing with Anvil requires a locally deployed version of the EntryPoint contract and is not immediately working with the below instructions

### 1. Network Setup

First, you'll need to deploy the necessary contracts to your local Anvil network:

1. Clone the EIP-7702 proxy contracts:

```bash
git clone https://github.com/amiecorso/eip7702-proxy-sandbox
cd eip7702-proxy-sandbox
```

2. Compile the contracts:

```bash
forge build
```

3. Start Anvil with EIP-7702 support:

```bash
anvil --hardfork prague
```

4. Deploy the proxy template and implementation contracts:

```bash
forge script script/UpgradeEOA.s.sol --rpc-url http://localhost:8545 --broadcast --ffi
```

### 2. Demo Setup

1. Clone this repository:

```bash
git clone <your-repo-url>
cd <your-repo-name>
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file:

```bash
cp .env.example .env
```

4. Start the development server:

```bash
npm run dev
```

The demo will use Anvil's pre-funded accounts for testing, so no additional configuration is needed.

### Local Anvil

- RPC URL: http://localhost:8545
- Chain ID: 31337
- Proxy Template: 0x2d95f129bCEbD5cF7f395c7B34106ac1DCfb0CA9

## Project Structure

- `app/lib/wallet-utils.ts`: Wallet creation and management utilities
- `app/lib/abi/`: Contract ABIs and addresses
- `app/components/`: React components for the UI
- `app/api/`: Backend API routes for relayer operations
