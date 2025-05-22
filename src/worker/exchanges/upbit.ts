import Exchange from '../exchange'
import Big from 'big.js'

export default class UPBIT extends Exchange {
  id = 'UPBIT'
  private locallySubscribedPairs = new Set<string>();
  private KRW_USD = new Big(0.00072);

  protected endpoints = {
    PRODUCTS: 'https://api.upbit.com/v1/market/all'
  }

  async getUrl() {
    return 'wss://api.upbit.com/websocket/v1'
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
      return false;
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

    // Per requirements, do not send an unsubscribe message to Upbit.
    // If we needed to inform the server to stop sending for this pair,
    // we would send an updated subscription list (similar to subscribe)
    // or handle it differently if Upbit had specific 'stop' mechanisms.
    // For now, local filtering in onMessage will handle unwanted messages.

    return true;
  }

  formatTrade(trade) {
    const tradePrice = new Big(trade.trade_price);

    return {
      exchange: this.id,
      pair: trade.code,
      timestamp: trade.trade_timestamp,
      price: tradePrice.times(this.KRW_USD).toNumber(),
      size: trade.trade_volume,
      side: trade.ask_bid === 'ASK' ? 'sell' : 'buy'
    }
  }

  onMessage(event, api) {
    let tradeData;
    try {
      // Decode ArrayBuffer to string
      const messageString = event.data instanceof ArrayBuffer ? new TextDecoder().decode(event.data) : event.data;
      tradeData = JSON.parse(messageString);
    } catch (e) {
      console.warn(`[${this.id}] Failed to parse JSON message:`, event.data, e);
      return;
    }

    if (
      !tradeData ||
      tradeData.type !== 'trade' ||
      tradeData.stream_type !== 'REALTIME' ||
      !this.locallySubscribedPairs.has(tradeData.code)
    ) {
      // Log or handle non-trade/malformed messages or non-subscribed pairs if necessary.
      // console.debug(`[${this.id}] Received non-trade message, unexpected data, or non-subscribed pair:`, event.data);
      return;
    }

    return this.emitTrades(api.id, [this.formatTrade(tradeData)]);
  }

  onApiCreated(api) {
    this.startKeepAlive(api, 'PING', 60000)
  }

  onApiRemoved(api) {
    this.stopKeepAlive(api)
  }
}
