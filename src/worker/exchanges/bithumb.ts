import Exchange from '../exchange'
import Big from 'big.js'

export default class BITHUMB extends Exchange {
  id = 'BITHUMB'
  private locallySubscribedPairs = new Set<string>();
  private KRW_USD = new Big(0.00072);
  protected endpoints = {
    PRODUCTS: 'https://api.bithumb.com/v1/market/all'
  }
  protected maxConnectionsPerApi = 100
  protected delayBetweenMessages = 250

  async getUrl() {
    return `wss://ws-api.bithumb.com/websocket/v1`
  }

  formatProducts(data) {
    return data.map(product => product.market)
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

    this.locallySubscribedPairs.add(pair);

    api.send(
        JSON.stringify([
            { ticket: 'aggr' },
            { type: 'trade', codes: [pair] },
            { format: 'DEFAULT' }
        ])
    );

    return true;
  }

  /**
   * Sub
   * @param {WebSocket} api
   * @param {string} pair
   */
  async unsubscribe(api, pair) {
    if (!(await super.unsubscribe(api, pair))) {
      return false;
    }

    this.locallySubscribedPairs.delete(pair);

    return true;
  }

  formatTrade(trade, pairCoin) {
    return {
      exchange: this.id,
      pair: pairCoin,
      timestamp: trade.trade_timestamp,
      price: trade.trade_price.times(this.KRW_USD).toNumber(),
      size: +trade.trade_volume,
      side: trade.ask_bid === 'BID' ? 'buy' : 'sell'
    };
  }

  onMessage(event, api) {
    const json = JSON.parse(event.data)

    if (json.type === "trade" && json.code) {
      if (this.locallySubscribedPairs.has(json.code)) {
        const trade = this.formatTrade(json, json.code);
        return this.emitTrades(api.id, [trade]);
      }
    }
  }
}
