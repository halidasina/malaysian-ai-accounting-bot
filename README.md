# BizBook - Malaysian AI Accounting Bot MVP

This project implements the core MVP for the Malaysian AI Accounting Bot as described in "The Blueprint".

## Features & Tiers Implemented
- **AI-Powered Data Extraction:** Integrates with Claude API (`@anthropic-ai/sdk`) to extract JSON from expenses.
- **Low-Friction Telegram Interface:** Built with `telegraf` for instant expense logging.
- **Malaysian SME Localisation:** Full bilingual support for Malay and English, using RM (Ringgit Malaysia).
- **Subscription Model Mocks:** Commands to handle Free, Basic, and Pro tiers (with receipt upload logic gated).

## Getting Started

1. Set up your environment variables:
   Rename `.env.example` to `.env`.
   ```bash
   cp .env.example .env
   ```
   Add your `TELEGRAM_BOT_TOKEN` from BotFather and your `ANTHROPIC_API_KEY`.

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the bot:
   ```bash
   node index.js
   ```

## Folder Structure
- `index.js` - Contains the core bot logic, Telegram command handlers, Claude API text extraction, and mock tiers.
- `database.json` - A simple local JSON store used for the MVP to manage user states, tiers, and extracted transaction data.

## Next Steps
- Implement real image uploading and Claude Vision API parsing payload (currently mocked).
- Implement PDF exporting feature for the Pro Tier.
- Set up automated 7-day nudges for the conversion funnel.
- Host the bot on a Free-Tier Hosting provider (e.g. Render, Railway, or VPS).
