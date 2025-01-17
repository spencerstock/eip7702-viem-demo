# EIP-7702 Wallet Demo

A simple demo application showcasing EIP-7702 wallet creation and upgrades using viem.

## Setup

### Local Development with Anvil

1. Install Foundry:
```bash
curl -L https://foundry.paradigm.xyz | bash
```

2. Start Anvil with Prague hardfork:
```bash
anvil --hardfork prague
```

3. Install dependencies:
```bash
npm install
```

4. Start the development server:
```bash
npm run dev
```

### Base Sepolia Testnet

1. Create a `.env` file from the example:
```bash
cp .env.example .env
```

2. Add your relayer wallet's private key to `.env`:
```
RELAYER_PRIVATE_KEY=your_private_key_here
```

3. Install dependencies and start the server:
```bash
npm install
npm run dev
```

## Usage

1. Click "Create new EOA Wallet" to generate a new wallet
2. Click "Upgrade EOA to Smart Wallet" to:
   - Sign an authorization for the proxy contract
   - Deploy the proxy using the relayer
3. The transaction hash will be displayed with a link to the block explorer

## Contract Addresses

- Base Sepolia:
  - Proxy: [TODO: Add address]
- Anvil:
  - Deploy manually using Foundry

## Development

- `app/lib/wallet-utils.ts`: Wallet creation and management
- `app/lib/abi/`: Contract ABIs and addresses