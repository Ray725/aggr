import Exchange from '../exchange'

export default class HYPERLIQUID_SPOT extends Exchange {
  id = 'HYPERLIQUID_SPOT'
  private subscriptions = {}
  private spotTokenMap: { [symbol: string]: string } = {} // Maps @1 -> PURR/USDC
  private spotTokens: any[] = []
  protected endpoints = {
    PRODUCTS: {
      url: 'https://api.hyperliquid.xyz/info',
      method: 'POST',
      data: JSON.stringify({ type: 'spotMeta' })
    }
  }
  protected maxConnectionsPerApi = 100
  protected delayBetweenMessages = 250

  async getUrl() {
    return `wss://api.hyperliquid.xyz/ws`
  }

  async fetchSpotMetadata() {
    try {
      const response = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'spotMeta' })
      });
      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`[${this.id}] Error fetching spot metadata:`, error);
      return null;
    }
  }

  async initializeSpotTokens() {
    const spotMeta = await this.fetchSpotMetadata();
    if (!spotMeta || !spotMeta.tokens || !spotMeta.universe) {
      console.warn(`[${this.id}] No spot metadata available`);
      return;
    }

    this.spotTokens = spotMeta.tokens;

    // Build the token map for USDC-denominated pairs only
    // spotMeta.universe contains the list of trading pairs
    // Each universe entry has a 'name' (e.g., "PURR/USDC") and 'tokens' array [tokenIndex1, tokenIndex2]
    // We want pairs where the quote token (second element) is USDC (index 0)

    // Find USDC index (should be 0)
    const usdcToken = this.spotTokens.find(t => t.name === 'USDC');
    const usdcIndex = usdcToken ? usdcToken.index : 0;

    for (const universeEntry of spotMeta.universe) {
      // Check if this pair is denominated in USDC (second token is USDC)
      if (universeEntry.tokens && universeEntry.tokens[1] === usdcIndex) {
        const baseTokenIndex = universeEntry.tokens[0];
        const baseToken = this.spotTokens.find(t => t.index === baseTokenIndex);

        if (baseToken) {
          const symbol = `@${baseTokenIndex}`;
          const pairName = `${baseToken.name}/USDC`;
          this.spotTokenMap[symbol] = pairName;
          console.debug(`[${this.id}] Mapped spot token ${symbol} -> ${pairName}`);
        }
      }
    }
  }

  formatProducts(data) {
    // Return array of USDC-denominated spot pairs
    if (!data || !data.tokens || !data.universe) {
      return [];
    }

    this.spotTokens = data.tokens;

    const usdcToken = data.tokens.find(t => t.name === 'USDC');
    const usdcIndex = usdcToken ? usdcToken.index : 0;

    const products = [];

    // Build token map and products list at the same time
    for (const universeEntry of data.universe) {
      // Only include USDC-denominated pairs
      if (universeEntry.tokens && universeEntry.tokens[1] === usdcIndex) {
        const baseTokenIndex = universeEntry.tokens[0];
        const baseToken = data.tokens.find(t => t.index === baseTokenIndex);

        if (baseToken && baseToken.name !== 'USDC') {
          const pairName = `${baseToken.name}/USDC`;
          products.push(pairName);

          // Also build the token map for subscriptions
          const symbol = `@${baseTokenIndex}`;
          this.spotTokenMap[symbol] = pairName;
        }
      }
    }

    return products;
  }

  /**
   * Sub
   * @param {WebSocket} api
   * @param {string} pair
   */
  async subscribe(api, pair) {
    if (!(await super.subscribe(api, pair))) {
      return
    }

    // Find the corresponding @ symbol for this spot pair
    const spotSymbol = Object.keys(this.spotTokenMap).find(
      key => this.spotTokenMap[key] === pair
    );

    if (!spotSymbol) {
      console.warn(`[${this.id}] No spot symbol found for pair ${pair}`);
      return false;
    }

    const coin = spotSymbol; // e.g., "@1"
    const subscription = { type: "trades", coin };
    const message = {
      method: "subscribe",
      subscription
    };

    api.send(JSON.stringify(message));
    this.subscriptions[pair] = subscription; // Store the subscription part for unsubscribing

    return true;
  }

  /**
   * Unsub
   * @param {WebSocket} api
   * @param {string} pair
   */
  async unsubscribe(api, pair) {
    if (!(await super.unsubscribe(api, pair))) {
      return false;
    }

    const originalSubscription = this.subscriptions[pair];
    if (!originalSubscription) {
      console.warn(`No subscription found for ${pair} to unsubscribe.`);
      return false;
    }

    const message = {
      method: "unsubscribe",
      subscription: originalSubscription
    };

    api.send(JSON.stringify(message));

    return true;
  }

  formatTrade(trade, pairCoin) {
    // Look up the pair name from the @ symbol
    const pair = this.spotTokenMap[pairCoin];
    if (!pair) {
      console.warn(`[${this.id}] Unknown spot symbol ${pairCoin}`);
      return null;
    }

    return {
      exchange: this.id,
      pair: pair,
      timestamp: trade.time,
      price: +trade.px,
      size: +trade.sz,
      side: trade.side === 'B' ? 'buy' : 'sell'
    };
  }

  onMessage(event, api) {
    const json = JSON.parse(event.data)

    // Based on the example, trades are in json.data array
    if (json.channel === "trades" && Array.isArray(json.data)) {
      const tradesToEmit = [];
      for (const tradeData of json.data) {
        // The 'coin' field from the trade data is used to form the pair
        // Only process trades that start with @ (spot trades)
        if (tradeData.coin && tradeData.coin.startsWith('@')) {
          const formattedTrade = this.formatTrade(tradeData, tradeData.coin);
          if (formattedTrade) {
            tradesToEmit.push(formattedTrade);
          }
        }
      }
      if (tradesToEmit.length > 0) {
        return this.emitTrades(api.id, tradesToEmit);
      }
    }
  }
}
