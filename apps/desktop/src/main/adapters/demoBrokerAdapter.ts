import type { BrokerAdapter, PlaceOrderRequest, PlaceOrderResult } from "./brokerAdapter";

export class DemoBrokerAdapter implements BrokerAdapter {
  id = "demo-broker";
  private seq = 0;

  async connect() {
    console.log("[demo-broker] connect");
  }

  async disconnect() {
    console.log("[demo-broker] disconnect");
  }

  async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    const orderId = `DEMO-${++this.seq}`;
    console.log("[demo-broker] placeOrder", { orderId, ...req });
    return { orderId, accepted: true };
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    console.log("[demo-broker] cancelOrder", { orderId });
    return true;
  }
}
